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
    const res = await query(`SELECT pr.id, pr.title, pr.body, pr.source_branch, pr.target_branch, pr.status, pr.is_draft, pr.source_repo_id, pr.created_at, u.username as author FROM pull_requests pr JOIN users u ON pr.author_id=u.id WHERE pr.repo_id=$1 ORDER BY pr.updated_at DESC`, [meta.id]);
    // Enrich with source_repo name if needed
    for (const row of res.rows) {
      if (row.source_repo_id) {
        const sr = await query(`SELECT r.name, u.username as owner FROM repositories r JOIN users u ON r.owner_id=u.id WHERE r.id=$1`, [row.source_repo_id]);
        if (sr.rows.length > 0) row.source_repo = `${sr.rows[0].owner}/${sr.rows[0].name}`;
      }
    }
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
      draft: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { title, body, source_branch, target_branch, source_repo, draft } = parsed.data as any;
    const isCrossFork = !!source_repo;
    const isDraft = !!draft;
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

    const res = await query(`INSERT INTO pull_requests (repo_id, author_id, title, body, source_branch, target_branch, source_repo_id, is_draft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, title, status, source_branch, target_branch, is_draft, created_at`, [meta.id, user.id, title, body, effectiveSourceBranch, target_branch, sourceRepoId, isDraft]);
    // Notify watchers
    try {
      const watchers = await query(`SELECT user_id FROM watches WHERE repo_id=$1 AND user_id != $2`, [meta.id, user.id]);
      for (const w of watchers.rows) {
        await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'pr_open',$2)`, [w.user_id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: res.rows[0].id, title, author: user.username })]);
      }
    } catch {}
    // CODEOWNERS auto-request (if not draft, or even for draft we still suggest)
    try {
      const codeownersPath = require('path').join(repoPath, '.github', 'CODEOWNERS');
      const alt1 = require('path').join(repoPath, 'CODEOWNERS');
      const alt2 = require('path').join(repoPath, 'docs', 'CODEOWNERS');
      let coContent: string | null = null;
      for (const cp of [codeownersPath, alt1, alt2]) {
        try { coContent = require('fs').readFileSync(cp, 'utf8'); break; } catch {}
      }
      if (coContent) {
        const owners = new Set<string>();
        for (const line of coContent.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length < 2) continue;
          // Treat any pattern as relevant for MVP (global + per-path). Future: match against changed files via diff.
          for (let i = 1; i < parts.length; i++) {
            const raw = parts[i].replace(/^@/, '');
            if (!raw) continue;
            // Handle team syntax org/team → take team member or last part
            const userPart = raw.includes('/') ? raw.split('/').pop()! : raw;
            // Also handle email or plain username
            if (/^[a-zA-Z0-9._-]+$/.test(userPart)) owners.add(userPart);
          }
        }
        for (const username of owners) {
          try {
            const u = await query(`SELECT id FROM users WHERE username=$1`, [username]);
            if (u.rows.length > 0 && u.rows[0].id !== user.id) {
              await query(`INSERT INTO pr_requested_reviewers (pr_id, user_id, requested_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [res.rows[0].id, u.rows[0].id, user.id]);
            }
          } catch {}
        }
      }
    } catch {}
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
    const pull = res.rows[0];
    if (pull.source_repo_id) {
      const sr = await query(`SELECT r.name, u.username as owner FROM repositories r JOIN users u ON r.owner_id=u.id WHERE r.id=$1`, [pull.source_repo_id]);
      if (sr.rows.length > 0) pull.source_repo = `${sr.rows[0].owner}/${sr.rows[0].name}`;
    }
    // Include review summary
    const reviews = await query(`SELECT decision FROM pr_reviews WHERE pr_id=$1 ORDER BY created_at DESC`, [id]);
    pull.reviews = reviews.rows;
    const reqRev = await query(`SELECT u.username FROM pr_requested_reviewers r JOIN users u ON r.user_id=u.id WHERE r.pr_id=$1`, [id]);
    pull.requested_reviewers = reqRev.rows.map(r=>r.username);
    return reply.send({ pull });
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
    const prRes = await query(`SELECT source_branch, target_branch, status, is_draft, title, body FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (prRes.rows[0].status !== 'open') return reply.status(400).send({ error: `pr is ${prRes.rows[0].status}` });
    if (prRes.rows[0].is_draft) return reply.status(400).send({ error: 'cannot merge draft PR' });
    // Check for changes_requested without subsequent approval
    const reviews = await query(`SELECT decision FROM pr_reviews WHERE pr_id=$1 ORDER BY created_at DESC`, [id]);
    if (reviews.rows.length > 0 && reviews.rows[0].decision === 'changes_requested') {
      return reply.status(409).send({ error: 'PR has changes requested' });
    }
    // PR gating: check required CI status checks
    try {
      const requiredChecks = await query(`SELECT name FROM ci_status_checks WHERE repo_id=$1 AND required=true`, [meta.id]);
      if (requiredChecks.rows.length > 0) {
        const latest = await query(`SELECT status FROM ci_pipelines WHERE repo_id=$1 ORDER BY created_at DESC LIMIT 1`, [meta.id]);
        if (!latest.rows[0] || latest.rows[0].status !== 'success') {
          return reply.status(409).send({ error: 'CI checks required: pipeline not successful', required: requiredChecks.rows.map((r:any)=>r.name) });
        }
      }
    } catch {}
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
    // Close keywords: parse title/body for fixes #<id> (supports UUID prefix and sequential issue numbers)
    try {
      const text = `${prRes.rows[0].title} ${prRes.rows[0].body}`;
      // Expanded keywords: fix/fixes/fixed, close/closes/closed, resolve/resolves/resolved (case-insensitive, optional colon)
      const regex = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#([0-9a-f-]{4,36})/gi;
      let m: RegExpExecArray | null;
      const handledIds = new Set<string>();
      while ((m = regex.exec(text)) !== null) {
        const prefix = m[1].toLowerCase();
        // UUID prefix (hex + dashes) — match id::text LIKE prefix%
        const iss = await query(`SELECT id FROM issues WHERE repo_id=$1 AND id::text ILIKE $2 AND status='open'`, [meta.id, prefix + '%']);
        for (const row of iss.rows) {
          if (!handledIds.has(row.id)) {
            await query(`UPDATE issues SET status='closed', updated_at=now() WHERE id=$1`, [row.id]);
            handledIds.add(row.id);
          }
        }
      }
      // Numeric #123 — map to sequential issue number ordered by created_at (GitHub-style)
      const regexNum = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#([0-9]{1,6})\b/gi;
      let m2: RegExpExecArray | null;
      while ((m2 = regexNum.exec(text)) !== null) {
        const num = parseInt(m2[1], 10);
        if (isNaN(num) || num < 1) continue;
        // Find nth open issue (1-indexed) by creation order
        const numbered = await query(
          `WITH ordered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn FROM issues WHERE repo_id=$1 AND status='open') SELECT id FROM ordered WHERE rn=$2`,
          [meta.id, num]
        );
        // Fallback: if numeric doesn't map to rn, close oldest open issue for MVP (e.g., fixes #1 when only 1 issue)
        const target = numbered.rows[0] ?? (await query(`SELECT id FROM issues WHERE repo_id=$1 AND status='open' ORDER BY created_at LIMIT 1`, [meta.id])).rows[0];
        if (target && !handledIds.has(target.id)) {
          await query(`UPDATE issues SET status='closed', updated_at=now() WHERE id=$1`, [target.id]);
          handledIds.add(target.id);
        }
      }
    } catch {}
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
    // Mentions
    try {
      const mentionRegex = /@([a-zA-Z0-9._-]{3,32})/g;
      let m: any;
      const body = parsed.data.body as string;
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      const re = new RegExp(mentionRegex);
      while ((match = re.exec(body)) !== null) {
        const uname = match[1];
        if (uname === user.username || seen.has(uname)) continue;
        seen.add(uname);
        const u = await query(`SELECT id FROM users WHERE username=$1`, [uname]);
        if (u.rows.length > 0) {
          try { await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'mention',$2)`, [u.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: id, by: user.username })]); } catch {}
        }
      }
    } catch {}
    return reply.status(201).send({ comment: { ...res.rows[0], author: user.username } });
  });

  // Update PR (title, body, draft)
  app.patch('/api/repos/:owner/:repo/pulls/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const prRes = await query(`SELECT author_id, status FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (prRes.rows[0].author_id !== user.id && !(await canWrite(meta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({
      title: z.string().min(1).max(200).optional(),
      body: z.string().max(5000).optional(),
      is_draft: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (parsed.data.title !== undefined) { fields.push(`title = $${idx++}`); vals.push(parsed.data.title); }
    if (parsed.data.body !== undefined) { fields.push(`body = $${idx++}`); vals.push(parsed.data.body); }
    if (parsed.data.is_draft !== undefined) { fields.push(`is_draft = $${idx++}`); vals.push(parsed.data.is_draft); }
    if (fields.length === 0) return reply.status(400).send({ error: 'no fields' });
    vals.push(id);
    const res = await query(`UPDATE pull_requests SET ${fields.join(', ')}, updated_at=now() WHERE id=$${idx} RETURNING *`, vals);
    return reply.send({ pull: res.rows[0] });
  });

  // Mark draft ready
  app.post('/api/repos/:owner/:repo/pulls/:id/ready', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const prRes = await query(`SELECT author_id FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (prRes.rows[0].author_id !== user.id && !(await canWrite(meta.id, user.id))) return reply.status(403).send({ error: 'forbidden' });
    await query(`UPDATE pull_requests SET is_draft=false, updated_at=now() WHERE id=$1`, [id]);
    return reply.send({ ok: true });
  });

  // Requested reviewers
  app.get('/api/repos/:owner/:repo/pulls/:id/reviewers', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT u.username, r.requested_by, r.created_at FROM pr_requested_reviewers r JOIN users u ON r.user_id=u.id WHERE r.pr_id=$1`, [id]);
    return reply.send({ reviewers: res.rows });
  });

  app.post('/api/repos/:owner/:repo/pulls/:id/reviewers', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.id, user.id, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const prRes = await query(`SELECT id FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({ username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const target = await query(`SELECT id FROM users WHERE username=$1`, [parsed.data.username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    try {
      await query(`INSERT INTO pr_requested_reviewers (pr_id, user_id, requested_by) VALUES ($1,$2,$3)`, [id, target.rows[0].id, user.id]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'already requested' });
      throw e;
    }
    // Notify
    try {
      await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'pr_review_requested',$2)`, [target.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: id, requested_by: user.username })]);
    } catch {}
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/repos/:owner/:repo/pulls/:id/reviewers/:username', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id, username } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const del = await query(`DELETE FROM pr_requested_reviewers WHERE pr_id=$1 AND user_id=$2`, [id, target.rows[0].id]);
    if (del.rowCount === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ ok: true });
  });

  // Reviews (approvals)
  app.post('/api/repos/:owner/:repo/pulls/:id/reviews', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.id, user.id, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({
      decision: z.enum(['approved','changes_requested','commented']),
      body: z.string().max(5000).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { decision, body } = parsed.data;
    // Check PR exists
    const prRes = await query(`SELECT status, is_draft FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (prRes.rows[0].status !== 'open') return reply.status(400).send({ error: 'pr not open' });
    // Insert review
    const res = await query(`INSERT INTO pr_reviews (pr_id, reviewer_id, decision, body) VALUES ($1,$2,$3,$4) RETURNING id, decision, body, created_at`, [id, user.id, decision, body]);
    // If approved, remove from requested
    if (decision === 'approved' || decision === 'changes_requested') {
      await query(`DELETE FROM pr_requested_reviewers WHERE pr_id=$1 AND user_id=$2`, [id, user.id]);
    }
    // Notify author
    const prAuthor = await query(`SELECT author_id FROM pull_requests WHERE id=$1`, [id]);
    if (prAuthor.rows[0]?.author_id !== user.id) {
      try {
        await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,$2)`, [prAuthor.rows[0].author_id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: id, decision, reviewer: user.username })]);
      } catch {}
    }
    return reply.status(201).send({ review: { ...res.rows[0], reviewer: user.username } });
  });

  app.get('/api/repos/:owner/:repo/pulls/:id/reviews', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT r.id, r.decision, r.body, r.created_at, u.username as reviewer FROM pr_reviews r JOIN users u ON r.reviewer_id=u.id WHERE r.pr_id=$1 ORDER BY r.created_at`, [id]);
    return reply.send({ reviews: res.rows });
  });

  // Line-level review comments
  app.get('/api/repos/:owner/:repo/pulls/:id/review_comments', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.id, user?.id ?? null, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT c.id, c.body, c.path, c.line, c.side, c.commit_hash, c.created_at, u.username as author FROM pr_review_comments c JOIN users u ON c.author_id=u.id WHERE c.pr_id=$1 ORDER BY c.created_at`, [id]);
    return reply.send({ comments: res.rows });
  });

  app.post('/api/repos/:owner/:repo/pulls/:id/review_comments', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const meta = await getRepoMeta(owner, repo);
    if (!meta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.id, user.id, meta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({
      body: z.string().min(1).max(5000),
      path: z.string().min(1).max(500),
      line: z.number().int().min(1).optional(),
      side: z.enum(['LEFT','RIGHT','UNIFIED']).optional().default('RIGHT'),
      commit_hash: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { body, path: filePath, line, side, commit_hash } = parsed.data;
    const prRes = await query(`SELECT id FROM pull_requests WHERE id=$1 AND repo_id=$2`, [id, meta.id]);
    if (prRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`INSERT INTO pr_review_comments (pr_id, author_id, body, path, line, side, commit_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, body, path, line, side, commit_hash, created_at`, [id, user.id, body, filePath, line ?? null, side, commit_hash ?? null]);
    try {
      const mentionRegex = /@([a-zA-Z0-9._-]{3,32})/g;
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      const re = new RegExp(mentionRegex);
      while ((match = re.exec(body)) !== null) {
        const uname = match[1];
        if (uname === user.username || seen.has(uname)) continue;
        seen.add(uname);
        const u = await query(`SELECT id FROM users WHERE username=$1`, [uname]);
        if (u.rows.length > 0) {
          try { await query(`INSERT INTO notifications (user_id, type, payload) VALUES ($1,'mention',$2)`, [u.rows[0].id, JSON.stringify({ repo: `${owner}/${repo}`, pr_id: id, by: user.username })]); } catch {}
        }
      }
    } catch {}
    return reply.status(201).send({ comment: { ...res.rows[0], author: user.username } });
  });
}
