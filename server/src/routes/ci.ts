import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite } from '../lib/permissions';
import { repoPathFor, execItehaas } from '../lib/vcs';
import { randomUUID } from 'crypto';

function validateOwnerRepo(o: string, r: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(o) && /^[a-zA-Z0-9._-]{1,100}$/.test(r);
}

async function getRepoMeta(owner: string, repo: string) {
  const res = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (res.rows.length === 0) return null;
  return res.rows[0] as { id: string; visibility: string };
}

// Simple in-memory runner simulation. In Phase 9 prod, replace with BullMQ+Redis + Docker.
async function simulateRun(pipelineId: string, repoPath: string) {
  const jobs = await query(`SELECT id FROM ci_jobs WHERE pipeline_id=$1`, [pipelineId]);
  for (const job of jobs.rows) {
    await query(`UPDATE ci_jobs SET status='running', started_at=now() WHERE id=$1`, [job.id]);
    // Simulate isolated execution: run `itehaas log --oneline` as dummy workload, capture logs
    let logs = '';
    try {
      const res = await execItehaas(['log', '--oneline'], { cwd: repoPath, timeout: 10000 });
      logs = `+ itehaas log --oneline\n${res.stdout || ''}${res.stderr || ''}\n+ echo "CI simulated"\nCI simulated: ok\n`;
      await query(`UPDATE ci_jobs SET status='success', logs=$1, finished_at=now() WHERE id=$2`, [logs, job.id]);
    } catch (e: any) {
      logs = `error: ${e.message}`;
      await query(`UPDATE ci_jobs SET status='failed', logs=$1, finished_at=now() WHERE id=$2`, [logs, job.id]);
    }
  }
  // Update pipeline status based on jobs
  const failed = await query(`SELECT 1 FROM ci_jobs WHERE pipeline_id=$1 AND status='failed'`, [pipelineId]);
  const newStatus = failed.rows.length > 0 ? 'failed' : 'success';
  await query(`UPDATE ci_pipelines SET status=$1, updated_at=now() WHERE id=$2`, [newStatus, pipelineId]);
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
      commit: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    let commitHash = parsed.data.commit;
    let ref = parsed.data.ref;

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    // If commit not provided, resolve HEAD
    if (!commitHash) {
      const headRes = await execItehaas(['log', '--oneline'], { cwd: repoPath });
      if (headRes.code === 0 && headRes.stdout.trim()) {
        // headRes stdout is short hash; need full via log full mode? Use branch check
        const fullRes = await execItehaas(['log'], { cwd: repoPath });
        const m = fullRes.stdout.match(/^commit ([0-9a-f]{64})$/m);
        if (m) commitHash = m[1];
      }
      if (!commitHash) return reply.status(400).send({ error: 'no commits to run CI' });
    }

    const pipeRes = await query(`INSERT INTO ci_pipelines (repo_id, ref, commit_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id, status, created_at`, [meta.id, ref, commitHash, user.id]);
    const pipelineId = pipeRes.rows[0].id;
    // Create default jobs: install → test → build (Phase 9 pipeline config YAML deferred, use static)
    const defaultJobs = ['install', 'test', 'build'];
    for (const name of defaultJobs) {
      await query(`INSERT INTO ci_jobs (pipeline_id, name) VALUES ($1,$2)`, [pipelineId, name]);
    }
    // Fire and forget simulation (don't await)
    setImmediate(() => simulateRun(pipelineId, repoPath).catch(()=>{}));
    return reply.status(201).send({ pipeline: { id: pipelineId, status: 'queued', commit: commitHash, ref } });
  });

  // List pipelines
  app.get('/api/repos/:owner/:repo/ci/pipelines', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT id, ref, commit_hash, status, created_at, updated_at FROM ci_pipelines WHERE repo_id=$1 ORDER BY created_at DESC LIMIT 20`, [meta.id]);
    return reply.send({ pipelines: res.rows });
  });

  // Get pipeline with jobs
  app.get('/api/repos/:owner/:repo/ci/pipelines/:id', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const pipe = await query(`SELECT id, ref, commit_hash, status, created_at FROM ci_pipelines WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (pipe.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const jobs = await query(`SELECT id, name, status, logs, started_at, finished_at FROM ci_jobs WHERE pipeline_id=$1 ORDER BY created_at`, [id]);
    return reply.send({ pipeline: pipe.rows[0], jobs: jobs.rows });
  });

  // Job logs
  app.get('/api/repos/:owner/:repo/ci/jobs/:jobId/logs', async (req, reply) => {
    const { owner, repo, jobId } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT j.logs, j.status FROM ci_jobs j JOIN ci_pipelines p ON j.pipeline_id=p.id WHERE j.id=$1 AND p.repo_id=$2`, [jobId, meta.id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ logs: res.rows[0].logs, status: res.rows[0].status });
  });

  // Secrets (admin only, stub)
  app.get('/api/repos/:owner/:repo/ci/secrets', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    // Only admin can view keys (not values)
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
}
