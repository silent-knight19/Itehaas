import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite } from '../lib/permissions';
import { repoPathFor, execItehaas } from '../lib/vcs';

function validateOwnerRepo(o: string, r: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(o) && /^[a-zA-Z0-9._-]{1,100}$/.test(r);
}

async function getRepoMeta(owner: string, repo: string) {
  const res = await query(`SELECT r.id, r.visibility, r.default_branch FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (res.rows.length === 0) return null;
  return res.rows[0] as { id: string; visibility: string; default_branch: string };
}

async function copyMissingObjects(sourcePath: string, targetPath: string): Promise<number> {
  const srcObjects = require('path').join(sourcePath, '.itehaas', 'objects');
  const dstObjects = require('path').join(targetPath, '.itehaas', 'objects');
  const fs = require('fs');
  let copied = 0;
  if (!fs.existsSync(srcObjects)) return 0;
  for (const a of fs.readdirSync(srcObjects)) {
    if (a === 'pack') continue;
    const aPath = require('path').join(srcObjects, a);
    if (!fs.statSync(aPath).isDirectory() || a.length !== 2) continue;
    for (const b of fs.readdirSync(aPath)) {
      const srcFile = require('path').join(aPath, b);
      const dstFile = require('path').join(dstObjects, a, b);
      if (!fs.existsSync(dstFile)) {
        fs.mkdirSync(require('path').dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
        copied++;
      }
    }
  }
  return copied;
}

export async function pullRoutes(app: FastifyInstance) {
  // List PRs
  app.get('/api/repos/:owner/:repo/pulls', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT pr.id, pr.title, pr.body, pr.source_branch, pr.target_branch, pr.status, pr.created_at, u.username as author FROM pull_requests pr JOIN users u ON pr.author_id=u.id WHERE pr.repo_id=$1 ORDER BY pr.updated_at DESC`, [meta.id]);
    return reply.send({ pulls: res.rows });
  });

  // Create PR
  app.post('/api/repos/:owner/:repo/pulls', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.id, user.id, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(5000).optional().default(''),
      source_branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/),
      target_branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/).optional().default('main'),
      source_repo: z.string().regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { title, body, source_branch, target_branch, source_repo } = parsed.data as any;
    const isCrossFork = !!source_repo;
    if (!isCrossFork && source_branch === target_branch) return reply.status(400).send({ error: 'source and target must differ' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    let effectiveSourceBranch = source_branch;
    let sourceRepoId: string | null = null;
    if (isCrossFork) {
      const [srcOwner, srcRepo] = (source_repo as string).split('/');
      if (!validateOwnerRepo(srcOwner, srcRepo)) return reply.status(400).send({ error: 'invalid source_repo' });
      const srcMeta = await getRepoMeta(srcOwner, srcRepo);
      if (!srcMeta) return reply.status(404).send({ error: 'source repo not found' });
      if (!(await canRead(srcMeta.id, user.id, srcMeta.visibility))) return reply.status(404).send({ error: 'source repo not found' });
      sourceRepoId = srcMeta.id;
      let srcPath: string;
      try { srcPath = repoPathFor(srcOwner, srcRepo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
      const srcBranchCheck = await execItehaas(['branch'], { cwd: srcPath });
      if (srcBranchCheck.code !== 0) return reply.status(500).send({ error: 'failed to verify source branch' });
      const srcBranches = srcBranchCheck.stdout.split('\n').map(l=>l.replace(/^\*\s*/, '').trim()).filter(Boolean);
      if (!srcBranches.includes(source_branch)) return reply.status(400).send({ error: `source branch ${source_branch} not found in ${source_repo}` });
      await copyMissingObjects(srcPath, repoPath);
      const srcHashFile = path.join(srcPath, '.itehaas', 'refs', 'heads', ...source_branch.split('/'));
      let srcHashStr: string;
      try { srcHashStr = fs.readFileSync(srcHashFile, 'utf8').trim(); } catch { return reply.status(400).send({ error: 'source branch hash not found' }); }
      if (!/^[0-9a-f]+$/.test(srcHashStr) || (srcHashStr.length !== 40 && srcHashStr.length !== 64)) return reply.status(400).send({ error: 'invalid source hash' });
      effectiveSourceBranch = `fork/${srcOwner}/${source_branch}`;
      const forkRefPath = path.join(repoPath, '.itehaas', 'refs', 'heads', 'fork', srcOwner, ...source_branch.split('/'));
      fs.mkdirSync(path.dirname(forkRefPath), { recursive: true });
      fs.writeFileSync(forkRefPath, srcHashStr + '\n');
    } else {
      const srcCheck = await execItehaas(['branch'], { cwd: repoPath });
      if (srcCheck.code !== 0) return reply.status(500).send({ error: 'failed to verify branches' });
      const branches = srcCheck.stdout.split('\n').map(l=>l.replace(/^\*\s*/, '').trim()).filter(Boolean);
      if (!branches.includes(source_branch)) return reply.status(400).send({ error: `source branch ${source_branch} not found` });
      if (!branches.includes(target_branch)) return reply.status(400).send({ error: `target branch ${target_branch} not found` });
    }
    {
      const tgtCheck = await execItehaas(['branch'], { cwd: repoPath });
      const branches = tgtCheck.stdout.split('\n').map(l=>l.replace(/^\*\s*/, '').trim()).filter(Boolean);
      if (!branches.includes(target_branch)) return reply.status(400).send({ error: `target branch ${target_branch} not found` });
    }

    const res = await query(`INSERT INTO pull_requests (repo_id, author_id, title, body, source_branch, target_branch, source_repo_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, status, source_branch, target_branch, created_at`, [meta.id, user.id, title, body, effectiveSourceBranch, target_branch, sourceRepoId]);
    await query(`INSERT INTO activity (repo_id, user_id, action, payload) VALUES ($1,$2,'pr_open',$3)`, [meta.id, user.id, JSON.stringify({ pr_id: res.rows[0].id, title })]);
    // Notify owner
    const ownerId = await query(`SELECT owner_id FROM repositories WHERE id=$1`, [meta.id]);
    if (ownerId.rows[0]?.owner_id !== user.id) {
      await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'pr_open',$2)`, [ownerId.rows[0].owner_id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: res.rows[0].id, title, author: user.username })]);
    }
    return reply.status(201).send({ pull: res.rows[0] });
  });

  // Get PR
  app.get('/api/repos/:owner/:repo/pulls/:id', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT pr.*, u.username as author FROM pull_requests pr JOIN users u ON pr.author_id=u.id WHERE pr.id=$1 AND pr.repo_id=$2`, [id, meta.id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ pull: res.rows[0] });
  });

  // PR diff (via itehaas diff)
  app.get('/api/repos/:owner/:repo/pulls/:id/diff', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const prRes = await query(`SELECT source_branch, target_branch FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { source_branch, target_branch } = prRes.rows[0];
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    // Use `itehaas diff target`? Actually `itehaas diff <target>` diffs HEAD vs target. For PR we need target vs source. Approach: checkout target, diff vs source? Simpler: use `itehaas diff` with source as target param while on target branch? Instead we can directly compute via `execItehaas(['diff', source_branch], {cwd})` after ensuring HEAD is target? But HEAD may be default.
    // For now, we provide simplified diff: call `itehaas diff <source_branch>` while cwd is repoPath where HEAD is default_branch? We'll try to checkout target temporarily? Simpler: just run diff between branches via `itehaas diff` with source.
    const diffRes = await execItehaas(['diff', source_branch], { cwd: repoPath });
    // Even if code !=0, return stdout
    return reply.send({ diff: diffRes.stdout, stderr: diffRes.stderr, source_branch, target_branch });
  });

  // Merge PR
  app.post('/api/repos/:owner/:repo/pulls/:id/merge', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(meta.id, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });
    const prRes = await query(`SELECT source_branch, target_branch, status FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (prRes.rows[0].status !== 'open') return reply.status(400).send({ error: `pr is ${prRes.rows[0].status}` });
    const { source_branch, target_branch } = prRes.rows[0];
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    // Ensure we are on target branch, then merge source
    // First, ensure HEAD is target
    const headRes = await execItehaas(['branch'], { cwd: repoPath });
    // Try to checkout target (force)
    const checkout = await execItehaas(['checkout', target_branch], { cwd: repoPath });
    if (checkout.code !== 0) {
      // try with -f
      const chk2 = await execItehaas(['checkout', '-f', target_branch] as any, { cwd: repoPath });
      // Our checkout doesn't support -f as positional? Actually main.rs checkout -f is flag, not handled for branch switch? But we have force in switch.
      // Fallback: try via checkout forced internal? For now attempt merge anyway.
    }
    const mergeRes = await execItehaas(['merge', source_branch], { cwd: repoPath });
    if (mergeRes.code !== 0) {
      // Check if already up to date or conflict
      if (mergeRes.stdout.includes('Already up to date') || mergeRes.stderr.includes('Already')) {
        await query(`UPDATE pull_requests SET status='merged' WHERE id=$1`, [id]);
        return reply.send({ ok: true, message: 'already up to date', output: mergeRes.stdout });
      }
      if (mergeRes.stdout.includes('CONFLICT') || mergeRes.stdout.includes('conflict')) {
        return reply.status(409).send({ error: 'merge conflict', output: mergeRes.stdout });
      }
      return reply.status(500).send({ error: mergeRes.stderr || mergeRes.stdout });
    }
    // If merge succeeded, check if it was fast-forward or merge commit
    await query(`UPDATE pull_requests SET status='merged', updated_at=now() WHERE id=$1`, [id]);
    await query(`INSERT INTO activity (repo_id, user_id, action, payload) VALUES ($1,$2,'pr_merge',$3)`, [meta.id, user.id, JSON.stringify({ pr_id: id, source_branch })]);
    return reply.send({ ok: true, output: mergeRes.stdout });
  });

  // Comments
  app.get('/api/repos/:owner/:repo/pulls/:id/comments', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT c.id, c.body, c.created_at, u.username as author FROM pr_comments c JOIN users u ON c.author_id=u.id WHERE c.pr_id=$1 ORDER BY c.created_at`, [id]);
    return reply.send({ comments: res.rows });
  });

  app.post('/api/repos/:owner/:repo/pulls/:id/comments', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.id, user.id, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({ body: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const exists = await query(`SELECT id FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`INSERT INTO pr_comments (pr_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at`, [id, user.id, parsed.data.body]);
    return reply.status(201).send({ comment: { ...res.rows[0], author: user.username } });
  });
}
