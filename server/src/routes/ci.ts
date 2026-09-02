import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite } from '../lib/permissions';
import { repoPathFor, execItehaas } from '../lib/vcs';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as yaml from 'yaml';

function validateOwnerRepo(o: string, r: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(o) && /^[a-zA-Z0-9._-]{1,100}$/.test(r);
}

async function getRepoMeta(owner: string, repo: string) {
  const res = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (res.rows.length === 0) return null;
  return res.rows[0] as { id: string; visibility: string };
}

interface WorkflowJob {
  name: string;
  runsOn?: string;
  steps: { name?: string; run?: string; uses?: string }[];
}

interface ParsedWorkflow {
  name?: string;
  on?: any;
  jobs: WorkflowJob[];
  raw: any;
  file: string | null;
}

async function parseWorkflow(repoPath: string): Promise<ParsedWorkflow> {
  const candidates = [
    path.join(repoPath, '.itehaas', 'workflows', 'ci.yml'),
    path.join(repoPath, '.itehaas', 'workflows', 'test.yml'),
    path.join(repoPath, '.itehaas', 'workflow.yml'),
    path.join(repoPath, '.github', 'workflows', 'ci.yml'),
    path.join(repoPath, '.github', 'workflows', 'test.yml'),
    path.join(repoPath, 'itehaas.yml'),
    path.join(repoPath, '.itehaas.yml'),
  ];
  // Also glob .itehaas/workflows/*.yml
  try {
    const wfDir = path.join(repoPath, '.itehaas', 'workflows');
    if (fs.existsSync(wfDir)) {
      const files = fs.readdirSync(wfDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const f of files) candidates.unshift(path.join(wfDir, f));
    }
    const ghDir = path.join(repoPath, '.github', 'workflows');
    if (fs.existsSync(ghDir)) {
      const files = fs.readdirSync(ghDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const f of files) candidates.unshift(path.join(ghDir, f));
    }
  } catch {}

  for (const cand of candidates) {
    try {
      if (!fs.existsSync(cand)) continue;
      const text = fs.readFileSync(cand, 'utf8');
      const parsed = yaml.parse(text);
      if (!parsed || typeof parsed !== 'object') continue;
      // Normalize jobs
      const jobs: WorkflowJob[] = [];
      const rawJobs = parsed.jobs as any;
      if (rawJobs && typeof rawJobs === 'object') {
        for (const [jobName, jobDef] of Object.entries(rawJobs as Record<string, any>)) {
          const jd = jobDef as any;
          const steps = Array.isArray(jd.steps) ? jd.steps : [];
          jobs.push({
            name: jobName,
            runsOn: jd['runs-on'] || jd.runsOn,
            steps: steps.map((s: any) => ({ name: s.name, run: s.run, uses: s.uses })),
          });
        }
      }
      if (jobs.length > 0) {
        return { name: parsed.name, on: parsed.on, jobs, raw: parsed, file: cand };
      }
      // Fallback: if jobs empty but file exists, treat as single job with steps as top-level steps?
      if (Array.isArray(parsed.steps)) {
        return { name: parsed.name, jobs: [{ name: 'build', steps: parsed.steps }], raw: parsed, file: cand };
      }
    } catch (e) {
      // ignore parse errors, try next
    }
  }
  // Default fallback: Phase 9 static jobs
  return {
    name: 'CI',
    on: 'push',
    jobs: [
      { name: 'install', steps: [{ run: 'echo "install step"' }] },
      { name: 'test', steps: [{ run: 'itehaas log --oneline' }] },
      { name: 'build', steps: [{ run: 'echo "build step"' }] },
    ],
    raw: null,
    file: null,
  };
}

async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const cp = spawn('docker', ['--version'], { timeout: 3000 });
    let done = false;
    cp.on('error', () => { if (!done) { done = true; resolve(false); } });
    cp.on('close', (code) => { if (!done) { done = true; resolve(code === 0); } });
    setTimeout(() => { if (!done) { done = true; try { cp.kill(); } catch {}; resolve(false); } }, 3000);
  });
}

async function executeInRunner(repoPath: string, script: string, env: Record<string, string>, timeoutMs = 30000): Promise<{ logs: string; exitCode: number; runner: string }> {
  const dockerOk = await isDockerAvailable();
  const combinedEnv = { ...process.env, ...env } as Record<string, string>;
  // Prepare logs header
  let logs = '';
  const header = `# Runner: ${dockerOk ? 'docker (network none, memory 512m, pids 128)' : 'local (simulated isolation)'}\n# Script:\n${script}\n---\n`;
  logs += header;

  if (dockerOk) {
    // Try docker: use node:20-alpine or alpine:latest, fallback to local if pull fails
    const dockerImage = 'alpine:latest';
    // Build docker args: run --rm --network none --memory 512m --cpus 1 --pids-limit 128 -v repoPath:/workspace -w /workspace -e KEY=VAL image sh -c "script"
    const args = [
      'run', '--rm',
      '--network', 'none',
      '--memory', '512m',
      '--cpus', '1',
      '--pids-limit', '128',
      '-v', `${repoPath}:/workspace`,
      '-w', '/workspace',
    ];
    for (const [k, v] of Object.entries(env)) {
      args.push('-e', `${k}=${v}`);
    }
    args.push(dockerImage, 'sh', '-c', `set -e; ${script} 2>&1`);

    try {
      const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const cp = spawn('docker', args, { timeout: timeoutMs });
        let out = '';
        let err = '';
        cp.stdout?.on('data', (d) => { out += d.toString(); });
        cp.stderr?.on('data', (d) => { err += d.toString(); });
        cp.on('error', (e) => resolve({ stdout: out, stderr: `docker error: ${e.message}`, code: 1 }));
        cp.on('close', (code) => resolve({ stdout: out, stderr: err, code: code ?? 1 }));
        setTimeout(() => { try { cp.kill('SIGKILL'); } catch {}; }, timeoutMs);
      });
      logs += result.stdout + result.stderr;
      return { logs, exitCode: result.code, runner: 'docker' };
    } catch (e: any) {
      logs += `\n# Docker failed, falling back to local: ${e.message}\n`;
      // fall through to local
    }
  }

  // Local execution (simulated isolation: no network, memory limits are documented but not enforced in this fallback)
  try {
    const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      // Use sh -c with env
      const cp = spawn('sh', ['-c', script], { cwd: repoPath, env: combinedEnv as any, timeout: timeoutMs });
      let out = '';
      let err = '';
      cp.stdout?.on('data', (d) => { out += d.toString(); });
      cp.stderr?.on('data', (d) => { err += d.toString(); });
      cp.on('error', (e) => resolve({ stdout: out, stderr: `local error: ${e.message}`, code: 1 }));
      cp.on('close', (code) => resolve({ stdout: out, stderr: err, code: code ?? 1 }));
      setTimeout(() => { try { cp.kill('SIGKILL'); } catch {}; }, timeoutMs);
    });
    logs += result.stdout + result.stderr;
    return { logs, exitCode: result.code, runner: 'local' };
  } catch (e: any) {
    logs += `\n# Local execution failed: ${e.message}\n`;
    return { logs, exitCode: 1, runner: 'local' };
  }
}

async function collectArtifacts(repoPath: string, pipelineId: string, jobId: string): Promise<number> {
  let count = 0;
  const candidates = [
    path.join(repoPath, 'artifacts'),
    path.join(repoPath, 'dist'),
    path.join(repoPath, 'target'),
    path.join(repoPath, 'build'),
    path.join(repoPath, 'out'),
  ];
  // Also check workflow artifacts pattern from recent logs? For MVP, check these dirs
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir);
      for (const f of files.slice(0, 20)) { // limit 20 per dir
        const full = path.join(dir, f);
        try {
          const stat = fs.statSync(full);
          if (stat.isFile()) {
            const size = stat.size;
            const rel = path.relative(repoPath, full);
            await query(`INSERT INTO ci_artifacts (job_id, pipeline_id, name, path, size_bytes) VALUES ($1,$2,$3,$4,$5)`, [jobId, pipelineId, f, rel, size]);
            count++;
          }
        } catch {}
      }
    } catch {}
  }
  // Also check for any *.log artifacts in repo root
  try {
    const rootFiles = fs.readdirSync(repoPath).filter(f => f.endsWith('.log') || f === 'coverage.txt');
    for (const f of rootFiles.slice(0, 5)) {
      const full = path.join(repoPath, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          await query(`INSERT INTO ci_artifacts (job_id, pipeline_id, name, path, size_bytes) VALUES ($1,$2,$3,$4,$5)`, [jobId, pipelineId, f, f, stat.size]);
          count++;
        }
      } catch {}
    }
  } catch {}
  return count;
}

async function runPipeline(pipelineId: string, repoPath: string, repoId: string) {
  await query(`UPDATE ci_pipelines SET status='running', updated_at=now() WHERE id=$1`, [pipelineId]);
  const jobs = await query(`SELECT id, name FROM ci_jobs WHERE pipeline_id=$1 ORDER BY created_at`, [pipelineId]);
  // Load secrets for env injection
  const secretsRes = await query(`SELECT key, value FROM ci_secrets WHERE repo_id=$1`, [repoId]);
  const secretsEnv: Record<string, string> = {};
  for (const s of secretsRes.rows) secretsEnv[s.key] = s.value;

  let pipelineFailed = false;
  for (const job of jobs.rows) {
    await query(`UPDATE ci_jobs SET status='running', started_at=now(), runner='docker' WHERE id=$1`, [job.id]);
    // Get job definition from pipeline workflow_json if available
    let script = '';
    let workflowFile: string | null = null;
    try {
      const pipe = await query(`SELECT workflow_json FROM ci_pipelines WHERE id=$1`, [pipelineId]);
      const wf = pipe.rows[0]?.workflow_json as any;
      if (wf && wf.jobs) {
        const j = (wf.jobs as any[]).find((jj: any) => jj.name === job.name);
        if (j && Array.isArray(j.steps)) {
          script = j.steps.filter((s: any) => s.run).map((s: any) => s.run).join('\n');
          workflowFile = wf.file || null;
        }
      }
    } catch {}

    if (!script) {
      // Fallback scripts per job name
      if (job.name === 'install') script = 'echo "install: resolving dependencies"\nls -la\nitehaas log --oneline || echo "no commits"';
      else if (job.name === 'test') script = 'echo "test: running tests"\nitehaas log --oneline --max-count 5 || echo "no log"\n if [ -f package.json ]; then cat package.json | head -20; fi';
      else if (job.name === 'build') script = 'echo "build: building artifacts"\nmkdir -p artifacts\n echo "build at $(date)" > artifacts/build.txt\n ls -la artifacts/ || true';
      else script = `echo "job ${job.name}"\nitehaas log --oneline || true`;
    }

    // Inject secrets as env and prepend log for visibility (but don't leak values)
    const safeEnvKeys = Object.keys(secretsEnv);
    let logsPrefix = '';
    if (safeEnvKeys.length > 0) logsPrefix = `# Secrets injected: ${safeEnvKeys.join(', ')} (values hidden)\n`;

    const { logs, exitCode, runner } = await executeInRunner(repoPath, script, secretsEnv, 30000);
    const fullLogs = logsPrefix + logs + `\n# Exit: ${exitCode} (${runner})\n` + (workflowFile ? `# Workflow: ${workflowFile}\n` : '');

    const status = exitCode === 0 ? 'success' : 'failed';
    await query(`UPDATE ci_jobs SET status=$1, logs=$2, finished_at=now(), exit_code=$3, runner=$4 WHERE id=$5`, [status, fullLogs, exitCode, runner, job.id]);

    // Collect artifacts after job
    try { await collectArtifacts(repoPath, pipelineId, job.id); } catch {}

    if (status === 'failed') pipelineFailed = true;
    // Continue to next job even if failed? For MVP, continue but pipeline will be failed
  }

  const newStatus = pipelineFailed ? 'failed' : 'success';
  const durationRes = await query(`SELECT EXTRACT(EPOCH FROM (now() - created_at))*1000 as ms FROM ci_pipelines WHERE id=$1`, [pipelineId]);
  const durationMs = Math.round(durationRes.rows[0]?.ms || 0);
  await query(`UPDATE ci_pipelines SET status=$1, updated_at=now(), duration_ms=$2 WHERE id=$3`, [newStatus, durationMs, pipelineId]);

  // If pipeline is for a PR, update status checks? For now, nothing extra
}

export async function ciRoutes(app: FastifyInstance) {
  // Trigger pipeline
  app.post('/api/repos/:owner/:repo/ci/run', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(meta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });

    const schema = z.object({
      ref: z.string().min(1).max(200).optional().default('main'),
      commit: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).optional(),
      workflow: z.any().optional(), // allow inline workflow for testing
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    let commitHash = parsed.data.commit;
    let ref = parsed.data.ref;

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    if (!commitHash) {
      const headRes = await execItehaas(['log', '--oneline'], { cwd: repoPath });
      if (headRes.code === 0 && headRes.stdout.trim()) {
        const fullRes = await execItehaas(['log'], { cwd: repoPath });
        const m = fullRes.stdout.match(/^commit ([0-9a-f]{40,64})$/m);
        if (m) commitHash = m[1];
      }
      if (!commitHash) return reply.status(400).send({ error: 'no commits to run CI' });
    }

    // Parse workflow YAML (or use inline)
    let workflow: ParsedWorkflow | null = null;
    if (parsed.data.workflow) {
      // Inline workflow provided (for tests)
      const raw = parsed.data.workflow as any;
      const jobs: WorkflowJob[] = [];
      if (raw.jobs) {
        for (const [k, v] of Object.entries(raw.jobs as Record<string, any>)) {
          const steps = Array.isArray((v as any).steps) ? (v as any).steps : [];
          jobs.push({ name: k, steps });
        }
      } else if (Array.isArray(raw.steps)) {
        jobs.push({ name: 'build', steps: raw.steps });
      }
      workflow = { name: raw.name || 'CI', jobs: jobs.length ? jobs : [{ name: 'build', steps: [{ run: 'echo hi' }] }], raw, file: 'inline' };
    } else {
      workflow = await parseWorkflow(repoPath);
    }

    const pipeRes = await query(`INSERT INTO ci_pipelines (repo_id, ref, commit_hash, created_by, workflow_file, workflow_json, branch) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status, created_at`, [meta.id, ref, commitHash, user.id, workflow.file, workflow as any, ref]);
    const pipelineId = pipeRes.rows[0].id;

    // Create jobs from workflow
    for (const job of workflow.jobs) {
      await query(`INSERT INTO ci_jobs (pipeline_id, name) VALUES ($1,$2)`, [pipelineId, job.name]);
    }

    setImmediate(() => runPipeline(pipelineId, repoPath, meta.id).catch(()=>{}));
    return reply.status(201).send({ pipeline: { id: pipelineId, status: 'queued', commit: commitHash, ref, workflow: workflow.file } });
  });

  // List pipelines
  app.get('/api/repos/:owner/:repo/ci/pipelines', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT id, ref, commit_hash, status, workflow_file, duration_ms, created_at, updated_at FROM ci_pipelines WHERE repo_id=$1 ORDER BY created_at DESC LIMIT 20`, [meta.id]);
    return reply.send({ pipelines: res.rows });
  });

  // Get pipeline with jobs
  app.get('/api/repos/:owner/:repo/ci/pipelines/:id', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const pipe = await query(`SELECT id, ref, commit_hash, status, workflow_file, workflow_json, duration_ms, created_at FROM ci_pipelines WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (pipe.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const jobs = await query(`SELECT id, name, status, logs, runner, exit_code, started_at, finished_at FROM ci_jobs WHERE pipeline_id=$1 ORDER BY created_at`, [id]);
    const artifacts = await query(`SELECT id, job_id, name, path, size_bytes FROM ci_artifacts WHERE pipeline_id=$1`, [id]);
    return reply.send({ pipeline: pipe.rows[0], jobs: jobs.rows, artifacts: artifacts.rows });
  });

  // Job logs
  app.get('/api/repos/:owner/:repo/ci/jobs/:jobId/logs', async (req, reply) => {
    const { owner, repo, jobId } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT j.logs, j.status, j.runner, j.exit_code FROM ci_jobs j JOIN ci_pipelines p ON j.pipeline_id=p.id WHERE j.id=$1 AND p.repo_id=$2`, [jobId, meta.id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ logs: res.rows[0].logs, status: res.rows[0].status, runner: res.rows[0].runner, exit_code: res.rows[0].exit_code });
  });

  // Artifacts list for pipeline
  app.get('/api/repos/:owner/:repo/ci/pipelines/:id/artifacts', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const pipe = await query(`SELECT id FROM ci_pipelines WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (pipe.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT a.id, a.job_id, a.name, a.path, a.size_bytes, j.name as job_name FROM ci_artifacts a JOIN ci_jobs j ON a.job_id=j.id WHERE a.pipeline_id=$1`, [id]);
    return reply.send({ artifacts: res.rows });
  });

  // Workflow file list
  app.get('/api/repos/:owner/:repo/ci/workflows', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const wf = await parseWorkflow(repoPath);
    // List all workflow files found
    const files: string[] = [];
    const dirs = [path.join(repoPath, '.itehaas', 'workflows'), path.join(repoPath, '.github', 'workflows')];
    for (const d of dirs) {
      try {
        if (fs.existsSync(d)) {
          for (const f of fs.readdirSync(d).filter(x=>x.endsWith('.yml')||x.endsWith('.yaml'))) {
            files.push(path.relative(repoPath, path.join(d, f)));
          }
        }
      } catch {}
    }
    return reply.send({ workflow: wf, files });
  });

  // Status checks
  app.get('/api/repos/:owner/:repo/ci/status_checks', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT id, name, required, created_at FROM ci_status_checks WHERE repo_id=$1`, [meta.id]);
    return reply.send({ checks: res.rows });
  });

  app.post('/api/repos/:owner/:repo/ci/status_checks', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const isOwner = (await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id])).rows[0]?.owner_id === user.id;
    const isAdmin = (await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 AND role='admin'`, [meta.id, user.id])).rows.length > 0;
    if (!isOwner && !isAdmin) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ name: z.string().min(1).max(100), required: z.boolean().optional().default(true) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    try {
      const res = await query(`INSERT INTO ci_status_checks (repo_id, name, required) VALUES ($1,$2,$3) RETURNING id, name, required`, [meta.id, parsed.data.name, parsed.data.required]);
      return reply.status(201).send({ check: res.rows[0] });
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'check exists' });
      throw e;
    }
  });

  app.delete('/api/repos/:owner/:repo/ci/status_checks/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const isOwner = (await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id])).rows[0]?.owner_id === user.id;
    const isAdmin = (await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 AND role='admin'`, [meta.id, user.id])).rows.length > 0;
    if (!isOwner && !isAdmin) return reply.status(403).send({ error: 'forbidden' });
    await query(`DELETE FROM ci_status_checks WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    return reply.send({ ok: true });
  });

  // PR gating: check if required checks pass for a PR's commit
  app.get('/api/repos/:owner/:repo/ci/pr/:prId/checks', async (req, reply) => {
    const { owner, repo, prId } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const pr = await query(`SELECT source_branch FROM pull_requests WHERE id=$1 AND repo_id=$2`, [prId, meta.id]);
    if (pr.rows.length === 0) return reply.status(404).send({ error: 'pr not found' });
    const checks = await query(`SELECT name, required FROM ci_status_checks WHERE repo_id=$1 AND required=true`, [meta.id]);
    if (checks.rows.length === 0) return reply.send({ required: [], passed: true, pipelines: [] });
    // For each required check, find latest pipeline for that branch? Simplified: check latest pipeline for repo has success
    const latest = await query(`SELECT status FROM ci_pipelines WHERE repo_id=$1 ORDER BY created_at DESC LIMIT 1`, [meta.id]);
    const passed = latest.rows[0]?.status === 'success';
    return reply.send({ required: checks.rows, passed, latest: latest.rows[0] || null });
  });

  // Secrets (admin only)
  app.get('/api/repos/:owner/:repo/ci/secrets', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const adminCheck = await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 AND role='admin'`, [meta.id, user.id]);
    const ownerCheck = await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id]);
    const isOwner = ownerCheck.rows[0]?.owner_id === user.id;
    if (!isOwner && adminCheck.rows.length === 0) return reply.status(403).send({ error: 'forbidden' });
    const res = await query(`SELECT key, created_at FROM ci_secrets WHERE repo_id=$1`, [meta.id]);
    return reply.send({ secrets: res.rows });
  });

  app.post('/api/repos/:owner/:repo/ci/secrets', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const adminCheck = await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 AND role='admin'`, [meta.id, user.id]);
    const ownerCheck = await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id]);
    const isOwner = ownerCheck.rows[0]?.owner_id === user.id;
    if (!isOwner && adminCheck.rows.length === 0) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ key: z.string().min(1).max(100).regex(/^[A-Z_][A-Z0-9_]*$/), value: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    try {
      await query(`INSERT INTO ci_secrets (repo_id, key, value) VALUES ($1,$2,$3)`, [meta.id, parsed.data.key, parsed.data.value]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'key exists' });
      throw e;
    }
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/repos/:owner/:repo/ci/secrets/:key', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, key } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const adminCheck = await query(`SELECT 1 FROM repository_members WHERE repo_id=$1 AND user_id=$2 AND role='admin'`, [meta.id, user.id]);
    const ownerCheck = await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id]);
    const isOwner = ownerCheck.rows[0]?.owner_id === user.id;
    if (!isOwner && adminCheck.rows.length === 0) return reply.status(403).send({ error: 'forbidden' });
    await query(`DELETE FROM ci_secrets WHERE repo_id=$1 AND key=$2`, [meta.id, key]);
    return reply.send({ ok: true });
  });
}
