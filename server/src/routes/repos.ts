import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
const inflateAsync = promisify(zlib.inflate);
import { query, getClient } from '../db';
import { repoPathFor, execItehaas } from '../lib/vcs';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite, isAdmin, isOwner } from '../lib/permissions';
import { auditLog } from '../lib/audit';
import { parsePagination, getRepoDiskUsage, repoQuotaBytes } from '../lib/budgets';

function validateOwnerRepo(owner: string, repo: string): boolean {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) return false;
  // S4: dot-segments are never valid identities (aliasing + traversal).
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return false;
  return true;
}

const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// S4: strict file path validation (no traversal, no absolute, no dotfiles that escape, no backslash, no null, no case collisions)
export function isValidFilePath(p: string): boolean {
  if (!p || p.length > 500) return false;
  if (p.includes('\0') || p.includes('\\')) return false;
  if (path.isAbsolute(p)) return false;
  // Decode up to twice to catch double-encoding (e.g., %252e%252e -> %2e%2e -> ..)
  let cur = p;
  for (let i = 0; i < 2; i++) {
    try {
      const dec = decodeURIComponent(cur);
      if (dec !== cur) cur = dec;
      else break;
    } catch {
      return false; // invalid encoding
    }
  }
  if (cur.includes('\0') || cur.includes('\\')) return false;
  if (path.isAbsolute(cur)) return false;
  // S4: reject control/format characters (terminal/log injection, FS normalization tricks).
  // Covers C0/C1 controls, DEL, BOM/ZWNBSP, bidi overrides — all attacker-controlled names.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f\u00ad\u200e\u200f\ufeff]/.test(cur)) return false;
  const parts = cur.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return false;
    if (part.endsWith('.') || part.endsWith(' ')) return false;
    const lower = part.toLowerCase();
    if (lower === '.itehaas' || lower === '.git' || lower === '.hg' || lower === '.svn') return false;
    if (lower.startsWith('itehaa~') || lower.startsWith('git~')) return false;
    const baseName = lower.split('.')[0];
    if (WINDOWS_RESERVED_NAMES.has(baseName)) return false;
    if (part.length > 100) return false;
  }
  if (cur.includes('//')) return false;
  return true;
}

export function isValidBranchRef(branch: string): boolean {
  if (!branch || branch.length > 100) return false;
  if (branch.includes('\0') || branch.includes('\\') || branch.includes(' ')) return false;
  // S15: leading dashes would parse as CLI flags in positional args (`log --rev -x`).
  if (branch.startsWith('-')) return false;
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) return false;
  if (branch.includes('..') || branch.includes('~') || branch.includes('^') || branch.includes(':') || branch.includes('?') || branch.includes('*') || branch.includes('[') || branch.includes('@{') || branch.endsWith('.lock')) return false;
  for (const part of branch.split('/')) {
    if (part === '' || part.startsWith('.')) return false;
  }
  if (!/^[a-zA-Z0-9._\/-]+$/.test(branch)) return false;
  return true;
}

// S13: shared remote-URL policy — used at creation time AND at fetch/push/pull
// execution time (stale `file://` remotes predating the creation gate must not
// become usable just because they sit in `.itehaas/config`). Returns an error
// message when blocked, null when allowed.
export function validateRemoteUrl(url: string): string | null {
  // SEC-007: Reject filesystem remotes (file://, local paths) to prevent cross-tenant repository exfiltration
  if (!/^https?:\/\//i.test(url)) {
    return 'invalid remote url: must be http:// or https://';
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return 'invalid remote url protocol';
    }
    if (u.username || u.password) {
      return 'credentials in remote url are not permitted';
    }
    const rawHost = u.hostname.toLowerCase();
    const h = rawHost.replace(/^\[|\]$/g, '');
    const isPrivate = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '::'
      || h === '0.0.0.0' || h === 'metadata.google.internal' || h.endsWith('.internal') || h.endsWith('.local')
      || h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('169.254.')
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
      // S13: fc/fd/fe80 prefixes only match IPv6 literals (which contain ':') —
      // plain DNS names starting with those letters (e.g. fcbank.com) are public
      // candidates left to the Rust DNS-time check.
      || h.startsWith('::ffff:') || (h.includes(':') && (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')));
    if (isPrivate && process.env.ALLOW_PRIVATE_REMOTES !== 'true' && process.env.ALLOW_LOCALHOST_REMOTE !== 'true') {
      return 'private or internal remote urls are forbidden';
    }
  } catch {
    return 'invalid remote url';
  }
  return null;
}

// S13: look up the stored URL of a configured remote (single `remote -v` call).
// Returns null when the remote is not configured.
export async function getStoredRemoteUrl(repoPath: string, remote: string): Promise<string | null> {
  const res = await execItehaas(['remote', '-v'], { cwd: repoPath });
  if (res.code !== 0) return null;
  for (const line of res.stdout.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (m && m[1] === remote) return m[2];
  }
  return null;
}

// S17: owner-only storage permissions. Repository content (including private
// repos) must never be world-readable on shared/multi-user hosts. Applied
// best-effort after every mkdir we own; umask/host ACLs remain the outer layer.
export async function secureRepoParentDirs(repoPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });
    // Harden the owner dir and the repo dir themselves (not the shared root,
    // whose ownership may belong to the deployer, not the service user).
    await fs.promises.chmod(path.dirname(repoPath), 0o700).catch(() => {});
    await fs.promises.chmod(repoPath, 0o700).catch(() => {});
  } catch {}
}

// Ensure repo exists on disk (handles ephemeral cloud containers where DB is persistent but container disk resets)
export async function ensureRepoOnDisk(repoPath: string): Promise<void> {
  if (!fs.existsSync(path.join(repoPath, '.itehaas'))) {
    await secureRepoParentDirs(repoPath);
    await execItehaas(['init', repoPath]);
  }
}

// S7: isAncestor cache (60s TTL)
const isAncestorCache = new Map<string, { value: boolean; expires: number }>();
function isAncestorCacheKey(repoPath: string, ancestor: string, descendant: string): string {
  return `${repoPath}:${ancestor}:${descendant}`;
}

export async function repoRoutes(app: FastifyInstance) {
  // Create repo: POST /api/repos — S14: 10/min
  app.post('/api/repos', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit, rateLimitReply } = await import('../lib/rateLimit');
    const rl = checkRateLimit(req as any, 'repo_create', 10, 60 * 1000);
    if (!rl.allowed) return rateLimitReply(reply as any, rl.resetMs);

    const schema = z.object({
      name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
      description: z.string().max(500).optional().default(''),
      visibility: z.enum(['public', 'private']).default('private'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { name, description, visibility } = parsed.data;

    const exists = await query(`SELECT id FROM repositories WHERE owner_id = $1 AND name = $2`, [user.id, name]);
    if (exists.rows.length > 0) return reply.status(409).send({ error: 'repository already exists' });

    const client = await getClient();
    let repo: any = null;
    try {
      await client.query('BEGIN');
      const repoRes = await client.query(
        `INSERT INTO repositories (owner_id, name, description, visibility) VALUES ($1, $2, $3, $4) RETURNING id, name, description, visibility, default_branch, created_at`,
        [user.id, name, description, visibility]
      );
      repo = repoRes.rows[0];
      await client.query(`INSERT INTO repository_members (repo_id, user_id, role) VALUES ($1, $2, 'admin')`, [repo.id, user.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const repoPath = repoPathFor(user.username, name);
    try {
      await secureRepoParentDirs(repoPath);
      const res = await execItehaas(['init', repoPath]);
      if (res.code !== 0) {
        await query(`DELETE FROM repositories WHERE id = $1`, [repo.id]);
        return reply.status(500).send({ error: `vcs init failed: ${res.stderr}` });
      }
    } catch (e: any) {
      await query(`DELETE FROM repositories WHERE id = $1`, [repo.id]);
      return reply.status(500).send({ error: e.message });
    }

    return reply.status(201).send({ repo: { ...repo, owner: user.username } });
  });

  // List repos (user's repos by default when logged in or with mine=true, public with all=true, or search)
  app.get('/api/repos', async (req, reply) => {
    const user = await getSessionUser(req as any);
    const userId = user?.id ?? null;
    const queryParams = req.query as any;

    const isMine = queryParams?.mine === 'true';
    const isAll = queryParams?.all === 'true';
    const search = queryParams?.search ? String(queryParams.search).trim() : null;

    const qLimit = Math.min(Math.max(parseInt(queryParams?.limit ?? '100', 10) || 100, 1), 100);
    const qOffset = Math.max(parseInt(queryParams?.offset ?? '0', 10) || 0, 0);

    let whereClause = '';
    const sqlParams: any[] = [];

    if (isMine) {
      if (!userId) {
        return reply.send({ repos: [] });
      }
      sqlParams.push(userId);
      whereClause = `WHERE (r.owner_id = $1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id = r.id AND m.user_id = $1))`;
    } else if (search) {
      if (userId) {
        sqlParams.push(userId, `%${search}%`);
        whereClause = `WHERE (r.visibility = 'public' OR r.owner_id = $1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id = r.id AND m.user_id = $1)) AND (r.name ILIKE $2 OR r.description ILIKE $2 OR u.username ILIKE $2)`;
      } else {
        sqlParams.push(`%${search}%`);
        whereClause = `WHERE r.visibility = 'public' AND (r.name ILIKE $1 OR r.description ILIKE $1 OR u.username ILIKE $1)`;
      }
    } else if (isAll || !userId) {
      whereClause = `WHERE r.visibility = 'public'`;
    } else {
      // Default when logged in without query flags -> user's own repos (GitHub model)
      sqlParams.push(userId);
      whereClause = `WHERE (r.owner_id = $1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id = r.id AND m.user_id = $1))`;
    }

    // S8: param LIMIT/OFFSET (was inline)
    const limitIdx = sqlParams.length + 1;
    const offsetIdx = sqlParams.length + 2;
    const res = await query(
      `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, r.updated_at, u.username as owner
       FROM repositories r JOIN users u ON r.owner_id = u.id
       ${whereClause}
       ORDER BY r.updated_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...sqlParams, qLimit, qOffset]
    );
    return reply.send({ repos: res.rows });
  });

  // Get single repo
  app.get('/api/repos/:owner/:repo', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const userId = user?.id ?? null;

    const res = await query(
      `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, r.updated_at, u.username as owner, u.id as owner_id
       FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const row = res.rows[0];
    const ok = await canRead(row.id, userId, row.visibility);
    if (!ok) return reply.status(404).send({ error: 'not found' });

    return reply.send({ repo: row });
  });

  // Update repo (PATCH) - admin only
  app.patch('/api/repos/:owner/:repo', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: repo mutation class — 20/min.
    const { checkRateLimit: crRepoMod, rateLimitReply: rlrRepoMod } = await import('../lib/rateLimit');
    const rlRepoMod = crRepoMod(req as any, 'repo_modify', 20, 60 * 1000);
    if (!rlRepoMod.allowed) return rlrRepoMod(reply as any, rlRepoMod.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    if (owner !== user.username) {
      // only owner can patch via username check, but also allow admin member? For now owner only for visibility change
      // Check admin
      const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
      if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
      const can = await isAdmin(r.rows[0].id, user.id);
      if (!can) return reply.status(403).send({ error: 'forbidden' });
    }

    const schema = z.object({
      description: z.string().max(500).optional(),
      visibility: z.enum(['public', 'private']).optional(),
      default_branch: z.string().min(1).max(100).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    // S3: default_branch is a ref that flows into VCSHZ operations — use the same
    // strict ref validation as file/branch endpoints (weak regex allowed .., //, @{).
    if (parsed.data.default_branch !== undefined && !isValidBranchRef(parsed.data.default_branch)) {
      return reply.status(400).send({ error: 'invalid default_branch' });
    }
    const { description, visibility, default_branch } = parsed.data;
    if (description === undefined && visibility === undefined && default_branch === undefined) {
      return reply.status(400).send({ error: 'no fields to update' });
    }

    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (description !== undefined) { fields.push(`description = $${idx++}`); vals.push(description); }
    if (visibility !== undefined) { fields.push(`visibility = $${idx++}`); vals.push(visibility); }
    if (default_branch !== undefined) { fields.push(`default_branch = $${idx++}`); vals.push(default_branch); }
    vals.push(owner);
    vals.push(repo);
    // Need owner_id join: update via id lookup
    const idRes = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$${idx++} AND r.name=$${idx++}`, vals.slice(-2));
    // Simpler: get id then update
    const repoIdRes = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (repoIdRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = repoIdRes.rows[0].id;
    const setClause = fields.join(', ');
    const updateVals = [...vals.slice(0, -2), repoId];
    // rebuild with correct placeholders
    const finalFields: string[] = [];
    const finalVals: any[] = [];
    let fIdx = 1;
    if (description !== undefined) { finalFields.push(`description = $${fIdx++}`); finalVals.push(description); }
    if (visibility !== undefined) { finalFields.push(`visibility = $${fIdx++}`); finalVals.push(visibility); }
    if (default_branch !== undefined) { finalFields.push(`default_branch = $${fIdx++}`); finalVals.push(default_branch); }
    finalVals.push(repoId);
    const upd = await query(`UPDATE repositories SET ${finalFields.join(', ')}, updated_at = now() WHERE id = $${fIdx} RETURNING id, name, description, visibility, default_branch, updated_at`, finalVals);
    // S18: visibility flips change the exposure boundary — always audited.
    if (visibility !== undefined && upd.rows[0]?.visibility !== undefined) {
      await auditLog({ userId: user.id, action: 'repo.visibility', target: `${owner}/${repo}:${upd.rows[0].visibility}`, req });
    }
    return reply.send({ repo: upd.rows[0] });
  });

  // Delete repo (owner/admin only) — S3: use isAdmin not just owner equality
  app.delete('/api/repos/:owner/:repo', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crRepoDel, rateLimitReply: rlrRepoDel } = await import('../lib/rateLimit');
    const rlRepoDel = crRepoDel(req as any, 'repo_modify', 20, 60 * 1000);
    if (!rlRepoDel.allowed) return rlrRepoDel(reply as any, rlRepoDel.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const res = await query(
      `SELECT r.id FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = res.rows[0].id;
    if (!(await isOwner(repoId, user.id))) return reply.status(403).send({ error: 'forbidden: only the repository owner can delete this repository' });

    // S15: session-pinned advisory lock (shared per-repo key with push/merge).
    // The lock lives on ONE pooled client: locking via pool.query and unlocking
    // on another backend would leak it forever.
    const { advisoryLockKeys: delKeys, lockClientAdvisory: lockDel, unlockClientAdvisory: unlockDel } = await import('../db');
    const delLockKey = delKeys(repoId);
    const delLockClient = await getClient();
    let releaseDelLock: (() => Promise<void>) | null = null;
    try {
      if (!(await lockDel(delLockClient, delLockKey))) {
        delLockClient.release();
        return reply.status(423).send({ error: 'ref locked, retry' });
      }
      releaseDelLock = async () => {
        await unlockDel(delLockClient, delLockKey);
        delLockClient.release();
      };
    } catch {
      try { delLockClient.release(); } catch {}
      return reply.status(423).send({ error: 'ref locked, retry' });
    }
    try {
      await query(`DELETE FROM repositories WHERE id = $1`, [repoId]);
      // S18: audit repo deletion
      await auditLog({ userId: user.id, action: 'repo.delete', target: `${owner}/${repo}`, req });

      const repoPath = repoPathFor(owner, repo);
      try {
        await fs.promises.rm(repoPath, { recursive: true, force: true });
      } catch {}
    } finally {
      await releaseDelLock!();
    }

    return reply.send({ ok: true });
  });

  // Fork: create fork under current user (requires read on upstream)
  app.post('/api/repos/:owner/:repo/fork', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: disk-heavy clone — 5/min per client.
    const { checkRateLimit: crFork, rateLimitReply: rlrFork } = await import('../lib/rateLimit');
    const rlFork = crFork(req as any, 'fork', 5, 60 * 1000);
    if (!rlFork.allowed) return rlrFork(reply as any, rlFork.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const upstreamRes = await query(
      `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.owner_id, u.username as owner_name
       FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    if (upstreamRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const upstream = upstreamRes.rows[0];
    const upstreamId = upstream.id;
    const upstreamName = upstream.name;

    const can = await canRead(upstreamId, user.id, upstream.visibility);
    if (!can) return reply.status(404).send({ error: 'not found' });

    // S7: disk budget — a fork duplicates storage; refuse when the upstream alone
    // already exceeds quota (the copy would start life over budget).
    const upstreamDiskPath = repoPathFor(upstream.owner_name, upstreamName);
    if (getRepoDiskUsage(upstreamDiskPath, repoQuotaBytes()) > repoQuotaBytes()) {
      return reply.status(413).send({ error: 'repository too large to fork (disk quota exceeded)' });
    }

    // Check if already forked by this user (same owner+name)
    const existing = await query(
      `SELECT r.id FROM repositories r WHERE r.owner_id = $1 AND r.name = $2`,
      [user.id, upstreamName]
    );
    if (existing.rows.length > 0) {
      // Check if this existing is already a fork of upstream
      const forkCheck = await query(`SELECT id FROM forks WHERE upstream_repo_id = $1 AND fork_repo_id = $2`, [upstreamId, existing.rows[0].id]);
      if (forkCheck.rows.length > 0) return reply.status(409).send({ error: 'already forked' });
      // If user already has repo with same name but not a fork, still conflict per GitHub: fork would collide
      return reply.status(409).send({ error: 'repository already exists' });
    }

    // Create fork repo DB entry
    const client = await getClient();
    let forkRepo: any = null;
    try {
      await client.query('BEGIN');
      const repoRes = await client.query(
        `INSERT INTO repositories (owner_id, name, description, visibility, default_branch) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, visibility, default_branch, created_at`,
        [user.id, upstreamName, upstream.description ?? '', upstream.visibility, upstream.default_branch]
      );
      forkRepo = repoRes.rows[0];
      await client.query(`INSERT INTO repository_members (repo_id, user_id, role) VALUES ($1, $2, 'admin')`, [forkRepo.id, user.id]);
      await client.query(`INSERT INTO forks (upstream_repo_id, fork_repo_id, forked_by) VALUES ($1,$2,$3)`, [upstreamId, forkRepo.id, user.id]);
      await client.query('COMMIT');
    } catch (e: any) {
      await client.query('ROLLBACK');
      // S15: concurrent double-fork check-then-act — the loser hits UNIQUE and
      // gets a clean 409 instead of a 500 (fail closed, retryable).
      if (e.code === '23505') return reply.status(409).send({ error: 'already forked' });
      throw e;
    } finally {
      client.release();
    }

    const upstreamPath = repoPathFor(upstream.owner_name, upstreamName);
    const forkPath = repoPathFor(user.username, upstreamName);
    try {
      await secureRepoParentDirs(forkPath);
      const res = await execItehaas(['clone', upstreamPath, forkPath]);
      if (res.code !== 0) {
        // Cleanup DB on clone failure
        await query(`DELETE FROM repositories WHERE id = $1`, [forkRepo.id]);
        return reply.status(500).send({ error: `fork clone failed: ${res.stderr}` });
      }
    } catch (e: any) {
      await query(`DELETE FROM repositories WHERE id = $1`, [forkRepo.id]);
      return reply.status(500).send({ error: e.message });
    }

    return reply.status(201).send({ repo: { ...forkRepo, owner: user.username }, forked_from: { owner, repo: upstreamName } });
  });

  // List forks of a repo
  app.get('/api/repos/:owner/:repo/forks', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const upstreamRes = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (upstreamRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: upstreamId, visibility } = upstreamRes.rows[0];
    if (!(await canRead(upstreamId, user?.id ?? null, visibility))) return reply.status(404).send({ error: 'not found' });
    // S7: output budget — paginated, never an unbounded collection.
    const page = parsePagination(req.query as any);
    if ('error' in page) return reply.status(400).send({ error: page.error });

    const forksRes = await query(
      `SELECT r.id, r.name, r.description, r.visibility, r.updated_at, u.username as owner, f.created_at as forked_at
       FROM forks f JOIN repositories r ON f.fork_repo_id = r.id JOIN users u ON r.owner_id = u.id
       WHERE f.upstream_repo_id = $1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [upstreamId, page.limit, page.offset]
    );
    // S3: private forks must not leak via a readable upstream's listing.
    const visibleForks = [];
    for (const row of forksRes.rows) {
      if (await canRead(row.id, user?.id ?? null, row.visibility)) visibleForks.push(row);
    }
    return reply.send({ forks: visibleForks });
  });

  // Network: upstream + forks
  app.get('/api/repos/:owner/:repo/network', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const repoRes = await query(`SELECT r.id, r.visibility, r.name FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (repoRes.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility, name } = repoRes.rows[0];
    if (!(await canRead(repoId, user?.id ?? null, visibility))) return reply.status(404).send({ error: 'not found' });
    // S7: output budget.
    const netPage = parsePagination(req.query as any);
    if ('error' in netPage) return reply.status(400).send({ error: netPage.error });

    // Check if this repo is itself a fork
    const forkInfo = await query(`SELECT f.upstream_repo_id, r.name as upstream_name, u.username as upstream_owner FROM forks f JOIN repositories r ON f.upstream_repo_id = r.id JOIN users u ON r.owner_id = u.id WHERE f.fork_repo_id = $1`, [repoId]);
    let upstream: any = null;
    if (forkInfo.rows.length > 0) {
      upstream = forkInfo.rows[0];
    } else {
      // Check if this repo is upstream (has forks) — for network we still want to show itself as upstream
      const selfInfo = await query(`SELECT u.username as owner, r.name FROM repositories r JOIN users u ON r.owner_id=u.id WHERE r.id=$1`, [repoId]);
      if (selfInfo.rows.length > 0) upstream = { upstream_owner: selfInfo.rows[0].owner, upstream_name: selfInfo.rows[0].name, upstream_repo_id: repoId };
    }

    // Get all forks of the ultimate upstream
    let ultimateUpstreamId = forkInfo.rows[0]?.upstream_repo_id ?? repoId;
    // If this repo is fork, ultimate is its upstream; else itself
    // For network, we want all forks of ultimate + ultimate itself
    const forksRes = await query(
      `SELECT r.id, r.name, r.visibility, u.username as owner, f.created_at as forked_at
       FROM forks f JOIN repositories r ON f.fork_repo_id = r.id JOIN users u ON r.owner_id = u.id
       WHERE f.upstream_repo_id = $1 ORDER BY f.created_at LIMIT $2 OFFSET $3`,
      [ultimateUpstreamId, netPage.limit, netPage.offset]
    );
    // S3: filter private forks the viewer cannot read.
    const visibleForks = [];
    for (const row of forksRes.rows) {
      if (await canRead(row.id, user?.id ?? null, row.visibility)) visibleForks.push(row);
    }
    // Get ultimate repo info
    const ultimateRes = await query(`SELECT r.id, r.name, u.username as owner FROM repositories r JOIN users u ON r.owner_id=u.id WHERE r.id=$1`, [ultimateUpstreamId]);
    const ultimate = ultimateRes.rows[0] ?? null;

    return reply.send({ upstream: ultimate, forks: visibleForks, current: { owner, repo: name } });
  });

  // Members: list
  app.get('/api/repos/:owner/:repo/members', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const res = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility } = res.rows[0];
    const ok = await canRead(repoId, user?.id ?? null, visibility);
    if (!ok) return reply.status(404).send({ error: 'not found' });
    // S7: output budget.
    const memPage = parsePagination(req.query as any);
    if ('error' in memPage) return reply.status(400).send({ error: memPage.error });

    const members = await query(
      `SELECT u.username, m.role, m.created_at FROM repository_members m JOIN users u ON m.user_id=u.id WHERE m.repo_id=$1 ORDER BY m.created_at LIMIT $2 OFFSET $3`,
      [repoId, memPage.limit, memPage.offset]
    );
    // include owner as admin if not in members? Owner is inserted as admin, so list covers.
    return reply.send({ members: members.rows });
  });

  // Members: add
  app.post('/api/repos/:owner/:repo/members', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: membership changes are privilege-relevant — 20/min.
    const { checkRateLimit: crMem, rateLimitReply: rlrMem } = await import('../lib/rateLimit');
    const rlMem = crMem(req as any, 'repo_members', 20, 60 * 1000);
    if (!rlMem.allowed) return rlrMem(reply as any, rlMem.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const res = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = res.rows[0].id;
    if (!(await isAdmin(repoId, user.id))) return reply.status(403).send({ error: 'forbidden' });

    const schema = z.object({
      username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
      role: z.enum(['read', 'write', 'admin']).default('read'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { username, role } = parsed.data;

    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const targetId = target.rows[0].id;
    if (targetId === user.id) return reply.status(400).send({ error: 'cannot add yourself' });

    try {
      await query(`INSERT INTO repository_members (repo_id, user_id, role) VALUES ($1,$2,$3)`, [repoId, targetId, role]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'already a member' });
      throw e;
    }
    // S18: membership grants are privilege changes — audited.
    await auditLog({ userId: user.id, action: 'repo.member_add', target: `${owner}/${repo}:${username}:${role}`, req });
    return reply.status(201).send({ ok: true, username, role });
  });

  // Members: remove
  app.delete('/api/repos/:owner/:repo/members/:username', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crMemDel, rateLimitReply: rlrMemDel } = await import('../lib/rateLimit');
    const rlMemDel = crMemDel(req as any, 'repo_members', 20, 60 * 1000);
    if (!rlMemDel.allowed) return rlrMemDel(reply as any, rlMemDel.resetMs);
    const { owner, repo, username } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const res = await query(`SELECT r.id, r.owner_id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, owner_id } = res.rows[0];
    if (!(await isAdmin(repoId, user.id))) return reply.status(403).send({ error: 'forbidden' });

    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const targetId = target.rows[0].id;
    if (targetId === owner_id) return reply.status(400).send({ error: 'cannot remove owner' });

    const del = await query(`DELETE FROM repository_members WHERE repo_id=$1 AND user_id=$2`, [repoId, targetId]);
    if (del.rowCount === 0) return reply.status(404).send({ error: 'not a member' });
    await auditLog({ userId: user.id, action: 'repo.member_remove', target: `${owner}/${repo}:${username}`, req });
    return reply.send({ ok: true });
  });

  // Members: update role
  app.patch('/api/repos/:owner/:repo/members/:username', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crMemPatch, rateLimitReply: rlrMemPatch } = await import('../lib/rateLimit');
    const rlMemPatch = crMemPatch(req as any, 'repo_members', 20, 60 * 1000);
    if (!rlMemPatch.allowed) return rlrMemPatch(reply as any, rlMemPatch.resetMs);
    const { owner, repo, username } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const res = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = res.rows[0].id;
    if (!(await isAdmin(repoId, user.id))) return reply.status(403).send({ error: 'forbidden' });

    const schema = z.object({ role: z.enum(['read', 'write', 'admin']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });

    const target = await query(`SELECT id FROM users WHERE username=$1`, [username]);
    if (target.rows.length === 0) return reply.status(404).send({ error: 'user not found' });
    const targetId = target.rows[0].id;

    const upd = await query(`UPDATE repository_members SET role=$1 WHERE repo_id=$2 AND user_id=$3 RETURNING role`, [parsed.data.role, repoId, targetId]);
    if (upd.rows.length === 0) return reply.status(404).send({ error: 'not a member' });
    await auditLog({ userId: user.id, action: 'repo.member_role', target: `${owner}/${repo}:${username}:${parsed.data.role}`, req });
    return reply.send({ ok: true, role: upd.rows[0].role });
  });

  // Advertise refs for HTTP clone (requires read, masks private as 404)
  // GET /api/repos/:owner/:repo/refs -> { refs: [{name, hash}], head, hasher }
  app.get('/api/repos/:owner/:repo/refs', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility, r.default_branch FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility, default_branch } = r.rows[0];
    if (!(await canRead(repoId, user?.id ?? null, visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    await ensureRepoOnDisk(repoPath);

    // Read hasher
    let hasher = 'sha256';
    try {
      const cfg = fs.readFileSync(path.join(repoPath, '.itehaas', 'config'), 'utf8');
      const m = cfg.match(/hasher\s*=\s*(\w+)/);
      if (m) hasher = m[1];
    } catch {}

    // Determine HEAD
    let head = `refs/heads/${default_branch || 'main'}`;
    try {
      const headContent = fs.readFileSync(path.join(repoPath, '.itehaas', 'HEAD'), 'utf8').trim();
      if (headContent.startsWith('ref: ')) head = headContent.slice(5).trim();
      else if (/^[0-9a-f]{64}$/.test(headContent)) head = headContent;
    } catch {}

    // List refs/heads
    const res = await execItehaas(['branch'], { cwd: repoPath });
    if (res.code !== 0) {
      if (res.stderr.includes('not a repository')) return reply.status(404).send({ error: 'repo not initialized' });
      return reply.status(500).send({ error: res.stderr });
    }
    const branchNames: string[] = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\*\s*/, '').trim());

    const refs: { name: string; hash: string }[] = [];
    for (const b of branchNames) {
      if (!/^[a-zA-Z0-9._\/-]+$/.test(b)) continue;
      const refPath = path.join(repoPath, '.itehaas', 'refs', 'heads', ...b.split('/'));
      try {
        const hash = fs.readFileSync(refPath, 'utf8').trim();
        if (/^[0-9a-f]{64}$/.test(hash)) {
          refs.push({ name: `refs/heads/${b}`, hash });
        }
      } catch {}
    }
    refs.sort((a, b) => a.name.localeCompare(b.name));
    return reply.send({ refs, head, hasher });
  });

  // Raw octet-stream parser for push (64 MiB limit, linear buffer collection)
  app.addContentTypeParser('application/octet-stream', function (request: any, payload: any, done: any) {
    const chunks: Buffer[] = [];
    let totalLength = 0;
    const MAX_ALLOWED = 64 * 1024 * 1024 + 1024;
    payload.on('data', (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > MAX_ALLOWED) {
        // Too large - abort stream immediately
        (payload as any).destroy(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    payload.on('end', () => done(null, Buffer.concat(chunks, totalLength)));
    payload.on('error', (err: any) => done(err, undefined));
  });

  // Helper: isAncestor via single-process CLI merge-base (SEC-016), with S7 bounded fallback
  async function isAncestor(repoPath: string, ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true;
    // S5-fresh: hashes flow from ref files + request bodies — reject malformed values
    // before spawning any process (fail closed, no subprocess on garbage).
    if (!/^[0-9a-f]{40}$/.test(ancestor) && !/^[0-9a-f]{64}$/.test(ancestor)) {
      throw new Error('invalid ancestor hash');
    }
    if (!/^[0-9a-f]{40}$/.test(descendant) && !/^[0-9a-f]{64}$/.test(descendant)) {
      throw new Error('invalid descendant hash');
    }
    const cacheKey = isAncestorCacheKey(repoPath, ancestor, descendant);
    const cached = isAncestorCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) return cached.value;

    // SEC-016: Try native single-process CLI merge-base --is-ancestor first (eliminates subprocess storm)
    try {
      const res = await execItehaas(['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoPath, timeout: 8000 });
      if (res.code === 0 && (res.stdout.trim() === 'true' || res.stdout.includes('true'))) {
        isAncestorCache.set(cacheKey, { value: true, expires: Date.now() + 60_000 });
        return true;
      }
      if (res.code === 1 || res.stdout.trim() === 'false' || res.stdout.includes('false')) {
        isAncestorCache.set(cacheKey, { value: false, expires: Date.now() + 60_000 });
        return false;
      }
    } catch {
      // If CLI command fails or in unit tests with mocked exec, fall through to bounded walk
    }

    const visited = new Set<string>();
    const stack: string[] = [descendant];
    let steps = 0;
    const MAX_STEPS = 2000; // S7: reduced from 5000
    while (stack.length > 0 && steps < MAX_STEPS) {
      const cur = stack.pop()!;
      if (cur === ancestor) {
        isAncestorCache.set(cacheKey, { value: true, expires: Date.now() + 60_000 });
        return true;
      }
      if (visited.has(cur)) continue;
      visited.add(cur);
      steps++;
      if (visited.size > 2000) {
        throw new Error('history too deep');
      }
      try {
        const res = await execItehaas(['cat-file', '-p', cur], { cwd: repoPath, timeout: 8000 });
        if (res.code !== 0) continue;
        // Parse commit parents: lines starting with "parent "
        for (const line of res.stdout.split('\n')) {
          if (line.startsWith('parent ')) {
            const h = line.slice(7).trim();
            if (/^[0-9a-f]{64}$/.test(h) && !visited.has(h)) stack.push(h);
          }
        }
      } catch {
        continue;
      }
    }
    if (steps >= MAX_STEPS && stack.length > 0) {
      throw new Error('history too deep');
    }
    isAncestorCache.set(cacheKey, { value: false, expires: Date.now() + 60_000 });
    return false;
  }

  function appendReflog(repoPath: string, refName: string, oldHash: string | null, newHash: string, message: string) {
    try {
      const zero = '0'.repeat(64);
      const old = oldHash ?? zero;
      // read user
      let name = 'Author';
      let email = 'author@example.com';
      try {
        const cfg = fs.readFileSync(path.join(repoPath, '.itehaas', 'config'), 'utf8');
        const inUser = cfg.includes('[user]');
        if (inUser) {
          const nameMatch = cfg.match(/name\s*=\s*(.+)/);
          const emailMatch = cfg.match(/email\s*=\s*(.+)/);
          if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
          if (emailMatch) email = emailMatch[1].trim().replace(/^["']|["']$/g, '');
        }
      } catch {}
      const ts = Math.floor(Date.now() / 1000);
      const tz = '+0000';
      const line = `${old} ${newHash} ${name} <${email}> ${ts} ${tz}\t${message}\n`;
      const logPath = path.join(repoPath, '.itehaas', 'logs', refName);
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line);
    } catch {}
  }

  // Push: upload object — POST /api/repos/:owner/:repo/objects/:hash
  app.post('/api/repos/:owner/:repo/objects/:hash', async (req, reply) => {
    const { owner, repo, hash } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    if (!/^[0-9a-f]+$/.test(hash) || (hash.length !== 40 && hash.length !== 64)) return reply.status(400).send({ error: 'invalid object hash' });
    const user = await getSessionUser(req as any);
    if (!user) return reply.status(401).send({ error: 'not authenticated' });
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(r.rows[0].id, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });
    // S14: 64M uploads with inflate+hash CPU cost (default 20 in test, 500 in prod/dev; configurable via OBJECT_UPLOAD_RATE_LIMIT).
    const { checkRateLimit: checkRLObj, rateLimitReply: rlObj } = await import('../lib/rateLimit');
    const defaultObjLimit = process.env.NODE_ENV === 'test' ? 20 : 500;
    const objLimit = parseInt(process.env.OBJECT_UPLOAD_RATE_LIMIT || String(defaultObjLimit), 10);
    const rlObjRes = checkRLObj(req as any, 'object_upload', objLimit, 60 * 1000);
    if (!rlObjRes.allowed) return rlObj(reply as any, rlObjRes.resetMs);

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    await ensureRepoOnDisk(repoPath);

    // Enforce size via Content-Length header if present
    const cl = (req.headers['content-length'] as string | undefined);
    if (cl && parseInt(cl, 10) > 64 * 1024 * 1024) return reply.status(413).send({ error: 'Object too large' });

    const body = (req as any).body as Buffer | undefined;
    if (!body || !Buffer.isBuffer(body)) return reply.status(400).send({ error: 'missing body' });
    if (body.length > 64 * 1024 * 1024) return reply.status(413).send({ error: 'Object too large' });
    if (body.length === 0) return reply.status(400).send({ error: 'empty object' });

    // S7: per-repository disk budget — repeated 64M pushes must not fill the host disk.
    // Fail closed with 413; override via REPO_QUOTA_BYTES (bytes) for large monorepos.
    const quota = repoQuotaBytes();
    const usage = getRepoDiskUsage(repoPath, quota);
    if (usage + body.length > quota) {
      return reply.status(413).send({ error: 'repository disk quota exceeded' });
    }

    const prefix = hash.slice(0, 2);
    const suffix = hash.slice(2);
    const objectPath = path.join(repoPath, '.itehaas', 'objects', prefix, suffix);
    const resolvedRoot = path.resolve(repoPath);
    const resolvedObj = path.resolve(objectPath);
    if (!resolvedObj.startsWith(resolvedRoot + path.sep)) return reply.status(400).send({ error: 'invalid hash' });

    // Dedup: if exists, verify and return 200
    try {
      const stat = await fs.promises.stat(objectPath);
      if (stat.isFile()) {
        // verify? assume ok
        return reply.send({ ok: true, hash, dedup: true });
      }
    } catch {}

    // S7/SEC-015: Verify object integrity asynchronously offloaded to threadpool, preventing event-loop starvation
    try {
      const canonical = await inflateAsync(body, { maxOutputLength: 64 * 1024 * 1024 + 1024 });
      const algo = hash.length === 40 ? 'sha1' : 'sha256';
      const computedHash = crypto.createHash(algo).update(canonical).digest('hex');
      if (computedHash !== hash) {
        // S18: corrupt/malicious object uploads are a detection signal (probing).
        await auditLog({ userId: user.id, action: 'vcs.object_rejected', target: `${owner}/${repo}:${hash.slice(0, 12)}`, req });
        return reply.status(400).send({ error: 'Corrupt object: hash mismatch' });
      }
    } catch (e: any) {
      await auditLog({ userId: user.id, action: 'vcs.object_rejected', target: `${owner}/${repo}:${hash.slice(0, 12)}`, req });
      return reply.status(400).send({ error: `Corrupt object: ${e.message || 'invalid zlib stream'}` });
    }

    // Atomic write via temp file
    const dir = path.dirname(objectPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
    try {
      await fs.promises.writeFile(tmp, body);
      try {
        await fs.promises.rename(tmp, objectPath);
      } catch (e: any) {
        if (e.code === 'EEXIST') {
          // race, dedup
          try { await fs.promises.unlink(tmp); } catch {}
          return reply.send({ ok: true, hash, dedup: true });
        }
        throw e;
      }
      return reply.status(201).send({ ok: true, hash });
    } catch (e: any) {
      try { await fs.promises.unlink(tmp); } catch {}
      return reply.status(500).send({ error: e.message });
    }
  });

  // S15: crash-safe ref lock files. A crash between `open(wx)` and `unlink` used to
  // leave a permanent 423 behind (fail-closed forever). Lock files now carry
  // `pid:timestamp`; a holder that is dead or older than the staleness bound is
  // stolen exactly once via atomic re-open (loser gets 423 and retries).
  const REF_LOCK_STALE_MS = 120_000;
  async function acquireRefLock(lockPath: string): Promise<fs.promises.FileHandle | null> {
    const stamp = async (fd: fs.promises.FileHandle) => {
      try {
        await fd.writeFile(`${process.pid}:${Date.now()}\n`);
      } catch {}
      return fd;
    };
    const opened = await fs.promises.open(lockPath, 'wx').catch(() => null);
    if (opened) return stamp(opened as fs.promises.FileHandle);
    let stale = false;
    try {
      const content = (await fs.promises.readFile(lockPath, 'utf8')).trim();
      const m = content.match(/^(\d+):(\d+)$/);
      if (m) {
        const pid = parseInt(m[1], 10);
        const ts = parseInt(m[2], 10);
        if (Date.now() - ts > REF_LOCK_STALE_MS) {
          stale = true;
        } else {
          try {
            process.kill(pid, 0);
          } catch (e: any) {
            if (e.code === 'ESRCH') stale = true; // holder pid is dead
          }
        }
      } else {
        // Pre-S15/foreign lock content: steal by age only.
        try {
          const st = await fs.promises.stat(lockPath);
          if (Date.now() - st.mtimeMs > REF_LOCK_STALE_MS) stale = true;
        } catch {}
      }
    } catch {}
    if (!stale) return null;
    await fs.promises.unlink(lockPath).catch(() => {});
    const retry = await fs.promises.open(lockPath, 'wx').catch(() => null);
    if (!retry) return null;
    return stamp(retry as fs.promises.FileHandle);
  }

  // Push: update ref — POST /api/repos/:owner/:repo/refs/heads/:branch
  app.post('/api/repos/:owner/:repo/refs/heads/*', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const branch = (req.params as any)['*'] as string;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    if (!branch || typeof branch !== 'string') return reply.status(400).send({ error: 'branch required' });
    if (branch.length > 100 || branch.includes('..') || branch.includes('//') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('\0') || branch.includes(' ') || branch.includes('~') || branch.includes('^') || branch.includes(':') || branch.includes('?') || branch.includes('*') || branch.includes('[') || branch.includes('\\') || branch.endsWith('.lock') || branch.includes('@{')) {
      return reply.status(400).send({ error: 'invalid branch name' });
    }
    // also check component starting with .
    for (const part of branch.split('/')) {
      if (part.startsWith('.') || part === '') return reply.status(400).send({ error: 'invalid branch name' });
    }

    const body = (req.body as any) ?? {};
    const { hash, force } = body as { hash?: string; force?: boolean };
    if (!hash || !/^[0-9a-f]+$/.test(hash) || (hash.length !== 40 && hash.length !== 64)) return reply.status(400).send({ error: 'invalid hash' });
    const useForce = !!force;

    const user = await getSessionUser(req as any);
    if (!user) return reply.status(401).send({ error: 'not authenticated' });
    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canWrite(r.rows[0].id, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });
    // S14: push 20/min
    const { checkRateLimit: checkRLPush, rateLimitReply: rlPush } = await import('../lib/rateLimit');
    const rlPushRes = checkRLPush(req as any, 'push', 20, 60 * 1000);
    if (!rlPushRes.allowed) return rlPush(reply as any, rlPushRes.resetMs);
    // S15: session-pinned advisory lock for push (per-repo) to prevent concurrent
    // isAncestor+write races. One key per repo shared with merge/delete so
    // ref-mutating operations exclude each other (FSEC-021: 64-bit keys).
    // The lock lives on ONE pooled client for the whole section: locking via
    // pool.query and unlocking on another backend would leak it forever.
    const { advisoryLockKeys, lockClientAdvisory, unlockClientAdvisory } = await import('../db');
    const pushLockKey = advisoryLockKeys(r.rows[0].id);
    const pushLockClient = await getClient();
    let releaseDbLock: (() => Promise<void>) | null = null;
    try {
      if (!(await lockClientAdvisory(pushLockClient, pushLockKey))) {
        pushLockClient.release();
        return reply.status(423).send({ error: 'ref locked, retry' });
      }
      releaseDbLock = async () => {
        await unlockClientAdvisory(pushLockClient, pushLockKey);
        pushLockClient.release();
      };
    } catch {
      try { pushLockClient.release(); } catch {}
      return reply.status(423).send({ error: 'ref locked, retry' });
    }

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) {
      await releaseDbLock();
      return reply.status(400).send({ error: e.message });
    }
    await ensureRepoOnDisk(repoPath);

    const refPath = path.join(repoPath, '.itehaas', 'refs', 'heads', ...branch.split('/'));
    const lockPath = refPath + '.lock';

    // Acquire lock (exclusive) — FS lock + DB advisory lock
    let lockFd: fs.promises.FileHandle | null = null;
    try {
      // Ensure parent dir exists
      await fs.promises.mkdir(path.dirname(refPath), { recursive: true });
      lockFd = await acquireRefLock(lockPath);
      if (!lockFd) {
        await releaseDbLock();
        return reply.status(423).send({ error: 'ref locked, retry' });
      }

      // Read current hash (algo-aware: SHA-256 64-hex or SHA-1 40-hex).
      // S5-fresh: the old 64-only gate silently skipped the fast-forward check on
      // SHA-1 repos (current=null → no FF verification → non-FF push accepted).
      let current: string | null = null;
      try {
        const cur = (await fs.promises.readFile(refPath, 'utf8')).trim();
        if (/^[0-9a-f]{64}$/.test(cur) || /^[0-9a-f]{40}$/.test(cur)) current = cur;
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }

      // Fast-forward check
      if (!useForce && current && current !== hash) {
        // Need to ensure object exists for both hashes
        const curExists = fs.existsSync(path.join(repoPath, '.itehaas', 'objects', current.slice(0, 2), current.slice(2)));
        const newExists = fs.existsSync(path.join(repoPath, '.itehaas', 'objects', hash.slice(0, 2), hash.slice(2)));
        if (!newExists) return reply.status(400).send({ error: 'object not found on server for new hash' });
        if (!curExists) {
          // current missing but file existed? should not happen
        } else {
          try {
            const ff = await isAncestor(repoPath, current, hash);
            if (!ff) return reply.status(409).send({ error: 'non-fast-forward push rejected (remote is not ancestor); use --force' });
          } catch (e: any) {
            if (e.message && e.message.includes('too deep')) {
              return reply.status(400).send({ error: 'history too deep' });
            }
            throw e;
          }
        }
      }

      // Verify new object is commit and exists
      const ver = await execItehaas(['cat-file', '-t', hash], { cwd: repoPath });
      if (ver.code !== 0) return reply.status(400).send({ error: 'object not found or not a commit' });
      if (ver.stdout.trim() !== 'commit') return reply.status(400).send({ error: 'ref must point to a commit' });

      // Atomic write ref
      const tmp = refPath + `.tmp-${process.pid}-${Date.now()}`;
      await fs.promises.writeFile(tmp, hash + '\n');
      await fs.promises.rename(tmp, refPath);

      // Append reflog
      const msg = `push: update ${branch} ${current ? current.slice(0,7) + '..' + hash.slice(0,7) : hash.slice(0,7)}${useForce ? ' (forced)' : ''}`;
      appendReflog(repoPath, `refs/heads/${branch}`, current, hash, msg);
      // Also HEAD reflog if HEAD points to this branch
      try {
        const headContent = (await fs.promises.readFile(path.join(repoPath, '.itehaas', 'HEAD'), 'utf8')).trim();
        if (headContent === `ref: refs/heads/${branch}`) {
          appendReflog(repoPath, 'HEAD', current, hash, msg);
        }
      } catch {}

      return reply.send({ ok: true, branch, hash, previous: current ?? null });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    } finally {
      if (lockFd) {
        try { await lockFd.close(); } catch {}
        try { await fs.promises.unlink(lockPath); } catch {}
      }
      await releaseDbLock();
    }
  });

  // Stream raw object bytes for HTTP clone (requires read, immutable, cacheable)
  // GET /api/repos/:owner/:repo/objects/:hash
  app.get('/api/repos/:owner/:repo/objects/:hash', async (req, reply) => {
    const { owner, repo, hash } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    if (!/^[0-9a-f]+$/.test(hash) || (hash.length !== 40 && hash.length !== 64)) return reply.status(400).send({ error: 'invalid object hash' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    // Validate repo path already via repoPathFor; no further SSRF
    const prefix = hash.slice(0, 2);
    const suffix = hash.slice(2);
    const objectPath = path.join(repoPath, '.itehaas', 'objects', prefix, suffix);

    // Ensure resolved object path stays within repo (defense in depth)
    const resolvedRoot = path.resolve(repoPath);
    const resolvedObj = path.resolve(objectPath);
    if (!resolvedObj.startsWith(resolvedRoot + path.sep)) {
      return reply.status(400).send({ error: 'invalid hash' });
    }

    try {
      const stat = await fs.promises.stat(objectPath);
      if (!stat.isFile()) return reply.status(404).send({ error: 'Object not found' });
      if (stat.size > 64 * 1024 * 1024) return reply.status(413).send({ error: 'Object too large' });
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Length', String(stat.size));
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Object-Hash', hash);
      // Stream without buffering whole file
      const stream = fs.createReadStream(objectPath);
      return reply.send(stream as any);
    } catch (e: any) {
      if (e.code === 'ENOENT') return reply.status(404).send({ error: 'Object not found' });
      return reply.status(500).send({ error: 'Internal error' });
    }
  });

  // Watch / Unwatch
  app.post('/api/repos/:owner/:repo/watch', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: like-spam class — 30/min.
    const { checkRateLimit: crWatch, rateLimitReply: rlrWatch } = await import('../lib/rateLimit');
    const rlWatch = crWatch(req as any, 'stars', 30, 60 * 1000);
    if (!rlWatch.allowed) return rlrWatch(reply as any, rlWatch.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user.id, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    try {
      await query(`INSERT INTO watches (user_id, repo_id) VALUES ($1,$2)`, [user.id, r.rows[0].id]);
    } catch (e: any) {
      if (e.code === '23505') return reply.send({ ok: true, watching: true });
      throw e;
    }
    return reply.send({ ok: true, watching: true });
  });

  app.delete('/api/repos/:owner/:repo/watch', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crUnwatch, rateLimitReply: rlrUnwatch } = await import('../lib/rateLimit');
    const rlUnwatch = crUnwatch(req as any, 'stars', 30, 60 * 1000);
    if (!rlUnwatch.allowed) return rlrUnwatch(reply as any, rlUnwatch.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    await query(`DELETE FROM watches WHERE user_id=$1 AND repo_id=$2`, [user.id, r.rows[0].id]);
    return reply.send({ ok: true, watching: false });
  });

  app.get('/api/repos/:owner/:repo/watch', async (req, reply) => {
    const user = await getSessionUser(req as any);
    if (!user) return reply.send({ watching: false });
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT 1 FROM watches WHERE user_id=$1 AND repo_id=$2`, [user.id, r.rows[0].id]);
    return reply.send({ watching: res.rows.length > 0 });
  });

  app.get('/api/repos/:owner/:repo/watchers', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    // S7: output budget.
    const watchPage = parsePagination(req.query as any);
    if ('error' in watchPage) return reply.status(400).send({ error: watchPage.error });
    const res = await query(`SELECT u.username FROM watches w JOIN users u ON w.user_id=u.id WHERE w.repo_id=$1 LIMIT $2 OFFSET $3`, [r.rows[0].id, watchPage.limit, watchPage.offset]);
    return reply.send({ watchers: res.rows.map(r=>r.username), count: res.rows.length });
  });

  // List branches via VCS

    // List branches via VCS (requires read)
  app.get('/api/repos/:owner/:repo/branches', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 60/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'branches', 60, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility } = r.rows[0];
    if (!(await canRead(repoId, user?.id ?? null, visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const res = await execItehaas(['branch'], { cwd: repoPath });
    if (res.code !== 0) {
      if (res.stderr.includes('not a repository')) return reply.status(404).send({ error: 'repo not initialized' });
      return reply.status(500).send({ error: res.stderr });
    }
    const branches = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\*\s*/, '').trim());
    return reply.send({ branches });
  });

  // Get commit log (requires read)
  app.get('/api/repos/:owner/:repo/log', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 30/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_log', 30, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility } = r.rows[0];
    if (!(await canRead(repoId, user?.id ?? null, visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    await ensureRepoOnDisk(repoPath);
    const maxCount = Math.min(Math.max(parseInt((req.query as any)?.max_count ?? '100', 10) || 100, 1), 200);
    const wantFull = (req.query as any)?.full === '1' || (req.query as any)?.full === 'true';

    // Branch/ref override: resolve ?ref=<branch> WITHOUT touching `.itehaas/HEAD`.
    // S15 (FSEC-006): the old code rewrote HEAD per request and restored it after —
    // concurrent requests with different ?ref= corrupted each other's history view
    // (and a crash mid-window left HEAD pointing at the wrong branch). The Rust CLI
    // now takes `--rev`, so reads never mutate repository state.
    const refParam: string | undefined = (req.query as any)?.ref;
    const revArgs: string[] = [];
    if (refParam && isValidBranchRef(refParam)) {
      const refFilePath = require('path').join(repoPath, '.itehaas', 'refs', 'heads', ...refParam.split('/'));
      try {
        const branchHash = require('fs').readFileSync(refFilePath, 'utf8').trim();
        if (/^[0-9a-f]{40,64}$/.test(branchHash)) {
          revArgs.push('--rev', refParam);
        }
      } catch { /* branch may not exist; fall back to current HEAD */ }
    }

    let logRes: { code: number | null; stdout: string; stderr: string };
    // Default to full hash for web (Phase 7) to enable tree browsing. Keep oneline for backwards compat if ?short=1
    if ((req.query as any)?.short === '1') {
      const args = ['log', '--oneline', '--max-count', String(maxCount), ...revArgs];
      logRes = await execItehaas(args, { cwd: repoPath }) as any;
    } else {
      // Full hash mode: parse `itehaas log` (no --oneline)
      const args = ['log', '--max-count', String(maxCount), ...revArgs];
      logRes = await execItehaas(args, { cwd: repoPath }) as any;
    }

    if (logRes.code !== 0) {
      if (logRes.stderr.includes('no commits yet')) return reply.send({ commits: [] });
      return reply.status(500).send({ error: logRes.stderr });
    }
    if ((req.query as any)?.short === '1') {
      const commits = logRes.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, ...msg] = line.split(' ');
          return { hash, message: msg.join(' ') };
        });
      return reply.send({ commits });
    }
    // Parse full log: split by "\ncommit "
    const raw = logRes.stdout.trim();
    if (!raw) return reply.send({ commits: [] });
    const blocks = raw.split('\ncommit ').map((b, i) => (i === 0 ? b : 'commit ' + b));
    const commits: { hash: string; message: string; author?: string; date?: string }[] = [];
    for (const block of blocks) {
      const lines = block.split('\n');
      const first = lines[0] || '';
      const m = first.match(/^commit ([0-9a-f]{64})$/);
      if (!m) continue;
      const hash = m[1];
      let author = '';
      let date = '';
      let msgLines: string[] = [];
      let inMsg = false;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('Author:')) author = line.slice(7).trim();
        else if (line.startsWith('Date:')) date = line.slice(5).trim();
        else if (line.trim() === '' && !inMsg) {
          // blank separates header and message
          if (lines[i + 1]?.startsWith('    ')) inMsg = true;
        } else if (inMsg) {
          // message lines are indented 4 spaces
          msgLines.push(line.replace(/^    /, ''));
        }
      }
      const message = msgLines.join('\n').trim().split('\n')[0] || '';
      commits.push({ hash, message, author, date });
      if (commits.length >= maxCount) break;
    }
    return reply.send({ commits });
  });

  // ===== New: Commit diff & compare (Full GitHub clone) =====

  // Helper: resolve rev (branch name or hash) to full 64 hex or null
  async function resolveRevToHash(repoPath: string, rev: string): Promise<string | null> {
    if (!rev) return null;
    if (rev === 'HEAD') {
      try {
        const head = fs.readFileSync(path.join(repoPath, '.itehaas', 'HEAD'), 'utf8').trim();
        if (head.startsWith('ref: ')) {
          const ref = head.slice(5).trim();
          const refPath = path.join(repoPath, '.itehaas', ref);
          const hash = fs.readFileSync(refPath, 'utf8').trim();
          if (/^[0-9a-f]{64}$/.test(hash)) return hash;
        } else if (/^[0-9a-f]{64}$/.test(head)) {
          return head;
        }
      } catch {}
      const res = await execItehaas(['log', '--max-count', '1'], { cwd: repoPath, maxOutput: 4 << 20 });
      const m = res.stdout.match(/^commit ([0-9a-f]{64})$/m);
      return m ? m[1] : null;
    }
    if (isValidBranchRef(rev)) {
      const refPath = path.join(repoPath, '.itehaas', 'refs', 'heads', ...rev.split('/'));
      try {
        const hash = fs.readFileSync(refPath, 'utf8').trim();
        if (/^[0-9a-f]{64}$/.test(hash)) return hash;
      } catch {}
    }
    // Try as hash (full or short 7+)
    if (/^[0-9a-f]{4,64}$/.test(rev)) {
      // Full hash check
      if (/^[0-9a-f]{64}$/.test(rev)) {
        const res = await execItehaas(['cat-file', '-t', rev], { cwd: repoPath, timeout: 8000 });
        if (res.code === 0) return rev;
      } else {
        // short hash: try resolve via cat-file with full? For simplicity, try via `show`?
        // Attempt to use itehaas cat-file directly may fail for short, so try resolve via objects scan
        // Fallback: try exec with short (our Rust supports short via resolve_rev)
        const res = await execItehaas(['cat-file', '-p', rev], { cwd: repoPath, timeout: 8000 });
        if (res.code === 0) {
          // Need to map short to full: find file via objects dir
          // Try to locate object dir matching prefix
          try {
            const objsRoot = path.join(repoPath, '.itehaas', 'objects');
            const prefix = rev.slice(0, 2);
            const suffixPrefix = rev.slice(2);
            const dir = path.join(objsRoot, prefix);
            if (fs.existsSync(dir)) {
              for (const f of fs.readdirSync(dir)) {
                const full = prefix + f;
                if (full.startsWith(rev) && /^[0-9a-f]{64}$/.test(full)) {
                  return full;
                }
              }
            }
          } catch {}
        }
      }
    }
    return null;
  }

  function parseDiffOutput(stdout: string): { files: any[], totalAdditions: number, totalDeletions: number } {
    const files: any[] = [];
    let current: any = null;
    let patchLines: string[] = [];
    const lines = stdout.split('\n');
    const flush = () => {
      if (!current) return;
      const patch = patchLines.join('\n');
      let additions = 0, deletions = 0;
      let isBinary = patch.includes('Binary files');
      for (const l of patchLines) {
        if (l.startsWith('+') && !l.startsWith('+++')) additions++;
        else if (l.startsWith('-') && !l.startsWith('---')) deletions++;
      }
      const pathForImage = current.newPath || current.path;
      const isImage = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(pathForImage);
      current.patch = patch;
      current.additions = additions;
      current.deletions = deletions;
      current.isBinary = isBinary;
      current.isImage = isBinary && isImage ? true : isImage && (isBinary || false);
      // For binary images, we treat isImage true regardless of binary flag?
      if (isImage) current.isImage = true;
      files.push(current);
      current = null;
      patchLines = [];
    };
    for (const line of lines) {
      const m = line.match(/^(added|deleted|modified|typechange|renamed)\s+(.+)$/);
      if (m) {
        flush();
        const status = m[1];
        const display = m[2];
        let path = display;
        let newPath: string | null = null;
        let similarity: number | null = null;
        if (status === 'renamed') {
          // format: old → new (85%)
          const rm = display.match(/^(.+)\s+→\s+(.+)\s+\((\d+)%\)$/);
          if (rm) {
            path = rm[1];
            newPath = rm[2];
            similarity = parseInt(rm[3], 10);
          } else {
            const rm2 = display.match(/^(.+)\s+→\s+(.+)$/);
            if (rm2) {
              path = rm2[1];
              newPath = rm2[2];
            }
          }
        }
        current = { path, newPath, status, similarity, patch: '', additions: 0, deletions: 0, isBinary: false, isImage: false };
        continue;
      }
      if (line.startsWith('diff --itehaas')) {
        patchLines.push(line);
        continue;
      }
      if (current) {
        patchLines.push(line);
      }
    }
    flush();
    let totalAdditions = 0, totalDeletions = 0;
    for (const f of files) { totalAdditions += f.additions; totalDeletions += f.deletions; }
    return { files, totalAdditions, totalDeletions };
  }

  async function getCommitMeta(repoPath: string, hash: string): Promise<any | null> {
    const res = await execItehaas(['cat-file', '-p', hash], { cwd: repoPath, timeout: 8000, maxOutput: 1 << 20 });
    if (res.code !== 0) return null;
    const content = res.stdout;
    const lines = content.split('\n');
    let tree = '', parents: string[] = [], author = '', committer = '', message = '';
    let inMsg = false;
    let msgLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inMsg) {
        if (line.startsWith('tree ')) tree = line.slice(5).trim();
        else if (line.startsWith('parent ')) parents.push(line.slice(7).trim());
        else if (line.startsWith('author ')) author = line.slice(7).trim();
        else if (line.startsWith('committer ')) committer = line.slice(9).trim();
        else if (line === '') { inMsg = true; }
      } else {
        msgLines.push(line);
      }
    }
    message = msgLines.join('\n');
    // Date parsing: author contains timestamp
    return { hash, tree, parents, author, committer, message };
  }

  // GET /api/repos/:owner/:repo/commits/:hash  (single commit diff)
  app.get('/api/repos/:owner/:repo/commits/:hash', async (req, reply) => {
    const { owner, repo, hash } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 60/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_read', 60, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    if (!/^[0-9a-f]{4,64}$/.test(hash)) return reply.status(400).send({ error: 'invalid hash' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    const { checkRateLimit: crDiff, rateLimitReply: rlrDiff } = await import('../lib/rateLimit');
    const rl = crDiff(req as any, 'diff', 30, 60 * 1000);
    if (!rl.allowed) return rlrDiff(reply as any, rl.resetMs);

    const fullHash = await resolveRevToHash(repoPath, hash);
    if (!fullHash) return reply.status(404).send({ error: 'commit not found' });

    const meta = await getCommitMeta(repoPath, fullHash);
    if (!meta) return reply.status(404).send({ error: 'commit not found' });

    // Parent diff: if root, diff against empty tree
    let diffStdout = '';
    if (meta.parents.length === 0) {
      // No parent: diff against empty -> show all as added
      // Use `itehaas diff` with empty vs commit? For root, we can call `diff` with same hash vs hash? Instead use cat-file tree handling:
      // Simpler: call `itehaas diff <hash> <hash>` will be empty, so we need to handle root specially by using diff_commits with parent empty.
      // We will produce diff by running `itehaas show` logic via `diff`? For MVP, run `cat-file -p` tree and diff via `itehaas diff` from empty?
      // Fallback: use `diff` between hash and hash but with --stat not useful. We'll instead run `itehaas show` via exec `show <hash>` and capture patch.
      const showRes = await execItehaas(['show', fullHash], { cwd: repoPath, maxOutput: 4 << 20, timeout: 15000 });
      diffStdout = showRes.stdout || '';
      // show output includes header commit/Author/Date/message + patches; we need to strip header and keep diff section
      // Our parseDiffOutput expects status lines, but show outputs `commit ...` header, not status. For root, we fallback to using `itehaas diff` technique:
      // Instead, if show parsing fails, fallback to empty
      // For now, try to use show's diff part: extract from first "diff --itehaas"
      const idx = diffStdout.indexOf('diff --itehaas');
      if (idx !== -1) diffStdout = diffStdout.slice(idx);
      else {
        // Try running diff for root: we have no parent, so we simulate by diffing empty tree 6ef19b... (known empty tree hash for sha256)
        // Empty tree hash computed: for sha256, blob header `tree 0\0` hash is 6ef19b... (from README)
        // But easier: run `itehaas diff <hash>` vs HEAD? Instead just return files as added via tree walk
        try {
          const treeRes = await execItehaas(['cat-file', '-p', meta.tree], { cwd: repoPath, maxOutput: 4 << 20 });
          const lines = treeRes.stdout.split('\n').filter(Boolean);
          let txt = '';
          for (const line of lines) {
            const m = line.match(/^(\d{5,6})\s+([0-9a-f]{64})\s+(.+)$/);
            if (m) {
              const name = m[3];
              txt += `added ${name}\n`;
              const blobRes = await execItehaas(['cat-file', '-p', m[2]], { cwd: repoPath, maxOutput: 4 << 20 });
              const patch = `diff --itehaas a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1 @@\n${blobRes.stdout.split('\n').map(l=>`+${l}`).join('\n')}\n`;
              txt += patch;
            }
          }
          diffStdout = txt;
        } catch {}
      }
    } else {
      const parentHash = meta.parents[0];
      const diffRes = await execItehaas(['diff', parentHash, fullHash], { cwd: repoPath, maxOutput: 4 << 20, timeout: 15000 });
      if (diffRes.code !== 0) return reply.status(500).send({ error: diffRes.stderr || 'diff failed' });
      diffStdout = diffRes.stdout;
    }

    const { files, totalAdditions, totalDeletions } = parseDiffOutput(diffStdout);
    const stats = { changedFiles: files.length, additions: totalAdditions, deletions: totalDeletions };

    // Also fetch parent commit short for UI
    return reply.send({ commit: meta, parent: meta.parents[0] || null, stats, files, patch: diffStdout });
  });

  // GET /api/repos/:owner/:repo/diff?from=&to=  (arbitrary pair)
  app.get('/api/repos/:owner/:repo/diff', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const { from, to } = req.query as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 20/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_diff', 20, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    if (!from || !to || typeof from !== 'string' || typeof to !== 'string') return reply.status(400).send({ error: 'from and to required' });
    if (from.length > 100 || to.length > 100 || from.includes('\0') || to.includes('\0')) return reply.status(400).send({ error: 'invalid rev' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    const { checkRateLimit: crDiff, rateLimitReply: rlrDiff } = await import('../lib/rateLimit');
    const rl = crDiff(req as any, 'diff', 30, 60 * 1000);
    if (!rl.allowed) return rlrDiff(reply as any, rl.resetMs);

    const fromHash = await resolveRevToHash(repoPath, from);
    const toHash = await resolveRevToHash(repoPath, to);
    if (!fromHash) return reply.status(404).send({ error: `from rev not found: ${from}` });
    if (!toHash) return reply.status(404).send({ error: `to rev not found: ${to}` });
    if (fromHash === toHash) return reply.send({ from: fromHash, to: toHash, stats: { changedFiles: 0, additions: 0, deletions: 0 }, files: [], commits: [] });

    const diffRes = await execItehaas(['diff', fromHash, toHash], { cwd: repoPath, maxOutput: 4 << 20, timeout: 15000 });
    if (diffRes.code !== 0) return reply.status(500).send({ error: diffRes.stderr || 'diff failed' });
    const { files, totalAdditions, totalDeletions } = parseDiffOutput(diffRes.stdout);
    const stats = { changedFiles: files.length, additions: totalAdditions, deletions: totalDeletions };

    // Commits between from..to (simple: walk log from to, stop at from)
    // For now, return empty commits; frontend can fetch log separately if needed
    // Attempt to get at most 50 commits between
    let commits: any[] = [];
    try {
      const logRes = await execItehaas(['log', '--max-count', '100'], { cwd: repoPath, maxOutput: 4 << 20 });
      if (logRes.code === 0) {
        const raw = logRes.stdout.trim();
        const blocks = raw.split('\ncommit ').map((b, i) => (i === 0 ? b : 'commit ' + b));
        for (const block of blocks) {
          const m = block.match(/^commit ([0-9a-f]{64})/);
          if (!m) continue;
          const h = m[1];
          if (h === fromHash) break;
          const msgMatch = block.match(/\n    (.+)/);
          const authorMatch = block.match(/Author:\s*(.+)/);
          const dateMatch = block.match(/Date:\s*(.+)/);
          commits.push({ hash: h, message: msgMatch ? msgMatch[1] : '', author: authorMatch ? authorMatch[1] : '', date: dateMatch ? dateMatch[1] : '' });
          if (h === toHash) break;
          if (commits.length >= 50) break;
        }
        // Reverse to chronological if needed; keep as log order (newest first)
      }
    } catch {}

    return reply.send({ from: fromHash, to: toHash, stats, files, commits, patch: diffRes.stdout });
  });

  // GET /api/repos/:owner/:repo/compare/:base...:head  (GitHub style)
  app.get('/api/repos/:owner/:repo/compare/*', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const spec = (req.params as any)['*'] as string;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 20/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_diff', 20, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    if (!spec || typeof spec !== 'string' || spec.length > 200) return reply.status(400).send({ error: 'invalid compare spec' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }

    const { checkRateLimit: crDiff, rateLimitReply: rlrDiff } = await import('../lib/rateLimit');
    const rl = crDiff(req as any, 'diff', 30, 60 * 1000);
    if (!rl.allowed) return rlrDiff(reply as any, rl.resetMs);

    // Parse spec: supports "base...head" (3-dot) or "base..head" (2-dot) or "base" (single)
    let baseRaw: string | null = null;
    let headRaw: string | null = null;
    let threeDot = false;
    if (spec.includes('...')) {
      const parts = spec.split('...');
      baseRaw = parts[0];
      headRaw = parts.slice(1).join('...');
      threeDot = true;
    } else if (spec.includes('..')) {
      const parts = spec.split('..');
      baseRaw = parts[0];
      headRaw = parts.slice(1).join('..');
      threeDot = false;
    } else {
      return reply.status(400).send({ error: 'compare spec must be base...head or base..head' });
    }
    if (!baseRaw || !headRaw) return reply.status(400).send({ error: 'invalid compare spec' });
    baseRaw = decodeURIComponent(baseRaw);
    headRaw = decodeURIComponent(headRaw);

    const baseHash = await resolveRevToHash(repoPath, baseRaw);
    const headHash = await resolveRevToHash(repoPath, headRaw);
    if (!baseHash) return reply.status(404).send({ error: `base not found: ${baseRaw}` });
    if (!headHash) return reply.status(404).send({ error: `head not found: ${headRaw}` });

    let fromHash = baseHash;
    let ancestor: string | null = null;
    if (threeDot) {
      // For 3-dot, find merge-base (common ancestor) via itehaas merge-base --is-ancestor checks + fallback to base if not ancestor
      // Try to find ancestor via `itehaas log --all` style? Simplest: if base is ancestor of head, use base as ancestor, else find via BFS using isAncestor cache helper
      // Use our isAncestor helper logic via exec `merge-base --is-ancestor`
      const isAncRes = await execItehaas(['merge-base', '--is-ancestor', baseHash, headHash], { cwd: repoPath, timeout: 8000 });
      if (isAncRes.code === 0) {
        ancestor = baseHash;
        fromHash = baseHash;
      } else {
        // Not ancestor: try to find common ancestor via brute force walk (limited)
        // For now, fallback to baseHash (2-dot behavior) to avoid missing ancestor logic
        // Could also try to compute via `find_common_ancestor` by spawning a small helper, but we fallback
        ancestor = baseHash;
        fromHash = baseHash;
      }
    }

    if (fromHash === headHash) return reply.send({ base: baseHash, head: headHash, ancestor, stats: { changedFiles: 0, additions: 0, deletions: 0 }, files: [], commits: [] });

    const diffRes = await execItehaas(['diff', fromHash, headHash], { cwd: repoPath, maxOutput: 4 << 20, timeout: 15000 });
    if (diffRes.code !== 0) return reply.status(500).send({ error: diffRes.stderr || 'diff failed' });
    const { files, totalAdditions, totalDeletions } = parseDiffOutput(diffRes.stdout);
    const stats = { changedFiles: files.length, additions: totalAdditions, deletions: totalDeletions };
    return reply.send({ base: baseHash, head: headHash, ancestor, from: fromHash, to: headHash, stats, files, commits: [], patch: diffRes.stdout, threeDot });
  });

  // Get tree / file via VCS (requires read)
  app.get('/api/repos/:owner/:repo/tree/:hash', async (req, reply) => {
    const { owner, repo, hash } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 60/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_read', 60, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    await ensureRepoOnDisk(repoPath);
    if (!/^[0-9a-f]{64}$/.test(hash)) return reply.status(400).send({ error: 'invalid hash' });
    const res = await execItehaas(['cat-file', '-p', hash], { cwd: repoPath });
    if (res.code !== 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ content: res.stdout });
  });

  // Get file content at branch: GET /api/repos/:owner/:repo/file/*?ref=main
  app.get('/api/repos/:owner/:repo/file/*', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const filePath = (req.params as any)['*'] as string;
    const ref = (req.query as any)?.ref as string | undefined;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    if (!filePath) return reply.status(400).send({ error: 'path required' });
    if (!isValidFilePath(filePath)) return reply.status(400).send({ error: 'invalid path' });
    if (ref && !isValidBranchRef(ref)) return reply.status(400).send({ error: 'invalid ref' });
    // S14: file 60/min
    const { checkRateLimit: crFile, rateLimitReply: rlrFile } = await import('../lib/rateLimit');
    const rlFile = crFile(req as any, 'file', 60, 60 * 1000);
    if (!rlFile.allowed) return rlrFile(reply as any, rlFile.resetMs);
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility, r.default_branch FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    const repoId = r.rows[0].id;
    const branch = ref || r.rows[0].default_branch || 'main';
    if (branch !== 'HEAD' && !isValidBranchRef(branch)) return reply.status(400).send({ error: 'invalid ref' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    await ensureRepoOnDisk(repoPath);
    // Resolve branch to commit
    const branchRes = await execItehaas(['branch'], { cwd: repoPath });
    if (branchRes.code !== 0) return reply.status(404).send({ error: 'repo not initialized' });
    const branches = branchRes.stdout.split('\n').map(l=>l.replace(/^\*\s*/, '').trim()).filter(Boolean);
    // Allow any branch via read_ref, not just list
    const hashRes = await execItehaas(['log', '--oneline', '--max-count', '1'], { cwd: repoPath });
    // Use revwalk via execItehaas cat-file? Simpler: use `show` to get file
    // Resolve branch hash via refs file
    const refPath = require('path').join(repoPath, '.itehaas', 'refs', 'heads', ...branch.split('/'));
    let commitHash: string | null = null;
    try { commitHash = require('fs').readFileSync(refPath, 'utf8').trim(); } catch {
      // Try via resolve HEAD if branch == HEAD
      if (branch === 'HEAD') {
        try { let headContent = require('fs').readFileSync(require('path').join(repoPath, '.itehaas', 'HEAD'), 'utf8').trim(); if (headContent.startsWith('ref: ')) { const rp = headContent.slice(5).trim(); headContent = require('fs').readFileSync(require('path').join(repoPath, '.itehaas', rp), 'utf8').trim(); } commitHash = headContent; } catch {}
      }
    }
    if (!commitHash || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(commitHash)) return reply.status(404).send({ error: 'branch not found' });
    // Use itehaas show to get file? Instead use tree traversal via execItehaas
    // We will use `cat-file -p` for commit to get tree, then walk
    const commitRes = await execItehaas(['cat-file', '-p', commitHash], { cwd: repoPath });
    if (commitRes.code !== 0) return reply.status(404).send({ error: 'commit not found' });
    const treeMatch = commitRes.stdout.match(/^tree ([0-9a-f]{40,64})$/m);
    if (!treeMatch) return reply.status(500).send({ error: 'invalid commit' });
    const treeHash = treeMatch[1];
    // Use itehaas cat-file to get tree and find file
    // For simplicity, use `show` via `cat-file` recursion in JS? We'll use a helper that calls `execItehaas` with `ls-files` like logic: we can call `execItehaas(['cat-file', '-p', treeHash])` and parse, but need recursive.
    // Instead, we can call our Rust helper via `execItehaas` with a custom command that we don't have. Simpler: use `node` to call `flame`? For MVP, we will use `execItehaas` with `show` that we can implement as `cat-file` for tree and then manually walk via JS using `execItehaas` recursively.
    // For now, we will implement a simple file fetch via `execItehaas` with `show` that we add as `show` command that already prints file? But `show` prints commit diff, not file.
    // Simpler: we will directly use `fs` to read the file from working tree if branch == current HEAD? But for historical branch, we need to read from objects.
    // We will implement a helper that walks tree via `cat-file -p` recursively in JS.
    async function findFileInTree(tHash: string, targetPath: string): Promise<string | null> {
      const parts = targetPath.split('/').filter(Boolean);
      let curTree = tHash;
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        const res = await execItehaas(['cat-file', '-p', curTree], { cwd: repoPath });
        if (res.code !== 0) return null;
        const lines = res.stdout.split('\n').filter(Boolean);
        let found: { mode: string, hash: string, name: string } | null = null;
        for (const line of lines) {
          const m = line.match(/^(\d{5,6})\s+([0-9a-f]{40,64})\s+(.+)$/);
          if (!m) continue;
          const [, mode, hash, name] = m;
          if (name === parts[i]) { found = { mode, hash, name }; break; }
        }
        if (!found) return null;
        if (isLast) {
          if (found.mode === '40000') return null; // is dir, not file
          const blobRes = await execItehaas(['cat-file', '-p', found.hash], { cwd: repoPath });
          if (blobRes.code !== 0) return null;
          return blobRes.stdout;
        } else {
          if (found.mode !== '40000') return null;
          curTree = found.hash;
        }
      }
      return null;
    }
    const content = await findFileInTree(treeHash, filePath);
    if (content === null) return reply.status(404).send({ error: 'file not found' });
    // Detect binary
    const isBinary = content.includes('\u0000') || /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 1000));
    return reply.send({ path: filePath, ref: branch, commit: commitHash, content, isBinary, size: Buffer.byteLength(content) });
  });

  // File history: GET /api/repos/:owner/:repo/history/*?ref=main
  app.get('/api/repos/:owner/:repo/history/*', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const filePath = (req.params as any)['*'] as string;
    const ref = (req.query as any)?.ref as string | undefined;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 30/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_log', 30, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    if (!filePath) return reply.status(400).send({ error: 'path required' });
    if (!isValidFilePath(filePath)) return reply.status(400).send({ error: 'invalid path' });
    if (ref && !isValidBranchRef(ref)) return reply.status(400).send({ error: 'invalid ref' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility, r.default_branch FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    const branch = ref || r.rows[0].default_branch || 'main';
    if (branch !== 'HEAD' && !isValidBranchRef(branch)) return reply.status(400).send({ error: 'invalid ref' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    // Use `itehaas log --follow --name-only` like via revwalk? For MVP, use `log --follow` if available, else just walk log and filter
    const logRes = await execItehaas(['log', '--oneline', '--max-count', '100', '--', filePath], { cwd: repoPath });
    // Our log --follow not fully implemented, but we can use `log --follow` if provided, else fallback to filtering via `log --name-only`
    // For now, we will run `log` with `follow` flag if available
    const followRes = await execItehaas(['log', '--follow', '--oneline', '--max-count', '100', '--', filePath], { cwd: repoPath });
    const raw = followRes.code === 0 ? followRes.stdout : logRes.stdout;
    const commits = raw.split('\n').filter(Boolean).map(line => {
      const [hash, ...msg] = line.split(' ');
      return { hash, message: msg.join(' ') };
    });
    // Also get full log via revwalk for accurate history (including renames)
    // For now return commits
    return reply.send({ path: filePath, ref: branch, commits });
  });

  // Blame: GET /api/repos/:owner/:repo/blame/*?ref=main
  app.get('/api/repos/:owner/:repo/blame/*', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const filePath = (req.params as any)['*'] as string;
    const ref = (req.query as any)?.ref as string | undefined;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S14: subprocess-backed read — 30/min per client.
    { const { checkRateLimit: crR, rateLimitReply: rlrR } = await import('../lib/rateLimit');
      const rlR = crR(req as any, 'vcs_log', 30, 60 * 1000);
      if (!rlR.allowed) return rlrR(reply as any, rlR.resetMs); }
    if (!filePath) return reply.status(400).send({ error: 'path required' });
    if (!isValidFilePath(filePath)) return reply.status(400).send({ error: 'invalid path' });
    if (ref && !isValidBranchRef(ref)) return reply.status(400).send({ error: 'invalid ref' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const blameRes = await execItehaas(['blame', filePath], { cwd: repoPath });
    if (blameRes.code !== 0) return reply.status(404).send({ error: blameRes.stderr || 'blame failed' });
    // Parse blame output: lines like "hash (author line_no): content"
    const lines = blameRes.stdout.split('\n').filter(Boolean).map(l => {
      // Our blame format: "hash (author line_no file): content"
      const m = l.match(/^([0-9a-f]{7,64})\s+\((.+?)\s+(\d+)\s+.+\):\s*(.*)$/);
      if (m) return { hash: m[1], author: m[2], line: parseInt(m[3], 10), content: m[4] };
      return { raw: l };
    });
    return reply.send({ path: filePath, ref: ref || 'HEAD', blame: lines });
  });

  // Remote operations: fetch & push (delegates to Rust engine via execItehaas)
  // POST /api/repos/:owner/:repo/fetch { remote?: string }
  app.post('/api/repos/:owner/:repo/fetch', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const { id: repoId, visibility } = r.rows[0];
    // fetch requires read (any member), but we require write for server-side fetch to avoid anon abuse
    if (!(await canRead(repoId, user.id, visibility))) return reply.status(404).send({ error: 'not found' });
    // also need at least read; if private and not member, already 404. For canWrite vs canRead, allow read.

    const schema = z.object({ remote: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional().default('origin') });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { remote } = parsed.data;
    // S13: remote name flows positionally into `fetch <remote>` — reject flag-like
    // names that the CLI would parse as options.
    if (remote.startsWith('-') || remote.startsWith('.')) {
      return reply.status(400).send({ error: 'invalid remote name' });
    }
    // S14: server-side fetch performs network I/O — 10/min per client.
    const { checkRateLimit: crFetch, rateLimitReply: rlrFetch } = await import('../lib/rateLimit');
    const rlFetch = crFetch(req as any, 'fetch', 10, 60 * 1000);
    if (!rlFetch.allowed) return rlrFetch(reply as any, rlFetch.resetMs);

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    // S13 (FSEC-019): execution-time gate on the STORED remote URL. Creation-time
    // validation postdates some remotes, and host-admin edits bypass the API —
    // re-validate here so a stale `file://` or literal-private remote can never be
    // fetched (DNS-name remotes remain protected by the Rust SafeResolver).
    const storedUrl = await getStoredRemoteUrl(repoPath, remote);
    if (!storedUrl) return reply.status(404).send({ error: 'remote not found' });
    const storedErr = validateRemoteUrl(storedUrl);
    if (storedErr) {
      try {
        await auditLog({ userId: user.id, action: 'ssrf.blocked', target: `${owner}/${repo}:${remote}`, req });
      } catch {}
      return reply.status(403).send({ error: `remote blocked: ${storedErr} (remove and re-add the remote)` });
    }
    const res = await execItehaas(['fetch', remote], { cwd: repoPath });
    if (res.code !== 0) return reply.status(500).send({ error: res.stderr || res.stdout });
    return reply.send({ ok: true, remote, output: res.stdout.trim() });
  });

  // POST /api/repos/:owner/:repo/push { remote?: string, branch?: string, force?: boolean }
  app.post('/api/repos/:owner/:repo/push', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = r.rows[0].id;
    if (!(await canWrite(repoId, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });

    const schema = z.object({
      remote: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional().default('origin'),
      branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/).optional(),
      force: z.boolean().optional().default(false),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { remote, branch, force } = parsed.data;
    // S5-fresh: branch flows positionally into `push <remote> <branch>` — the schema
    // regex alone allows .., //, @{. Enforce strict ref validation (as in S3 PR create).
    if (branch !== undefined && !isValidBranchRef(branch)) {
      return reply.status(400).send({ error: 'invalid branch name' });
    }
    // S13: flag-like remote names + execution-time stored-URL gate (see fetch).
    if (remote.startsWith('-') || remote.startsWith('.')) {
      return reply.status(400).send({ error: 'invalid remote name' });
    }
    // S14: push runs network I/O — 10/min per client (ref-update CAS has its own 20/min).
    const { checkRateLimit: crNetPush, rateLimitReply: rlrNetPush } = await import('../lib/rateLimit');
    const rlNetPush = crNetPush(req as any, 'fetch', 10, 60 * 1000);
    if (!rlNetPush.allowed) return rlrNetPush(reply as any, rlNetPush.resetMs);

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const storedPushUrl = await getStoredRemoteUrl(repoPath, remote);
    if (!storedPushUrl) return reply.status(404).send({ error: 'remote not found' });
    const storedPushErr = validateRemoteUrl(storedPushUrl);
    if (storedPushErr) {
      try {
        await auditLog({ userId: user.id, action: 'ssrf.blocked', target: `${owner}/${repo}:${remote}`, req });
      } catch {}
      return reply.status(403).send({ error: `remote blocked: ${storedPushErr} (remove and re-add the remote)` });
    }
    const args = ['push', remote];
    if (branch) args.push(branch);
    if (force) args.push('--force');
    const res = await execItehaas(args, { cwd: repoPath });
    if (res.code !== 0) {
      // non-fast-forward maps to 500 with message, but client may want 409
      if (res.stderr.includes('non-fast-forward')) return reply.status(409).send({ error: res.stderr.trim() });
      return reply.status(500).send({ error: res.stderr || res.stdout });
    }
    return reply.send({ ok: true, remote, output: res.stdout.trim() });
  });

  // POST /api/repos/:owner/:repo/pull { remote?: string, branch?: string }
  app.post('/api/repos/:owner/:repo/pull', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });

    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = r.rows[0].id;
    if (!(await canWrite(repoId, user.id))) return reply.status(403).send({ error: 'forbidden: write required' });

    const schema = z.object({
      remote: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional().default('origin'),
      branch: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/).optional(),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { remote, branch } = parsed.data;
    // S5-fresh: branch flows positionally into `pull <remote> <branch>` — strict ref check.
    if (branch !== undefined && !isValidBranchRef(branch)) {
      return reply.status(400).send({ error: 'invalid branch name' });
    }
    // S13: flag-like remote names + execution-time stored-URL gate (see fetch).
    if (remote.startsWith('-') || remote.startsWith('.')) {
      return reply.status(400).send({ error: 'invalid remote name' });
    }
    // S14: pull runs fetch + merge subprocesses — 10/min per client.
    const { checkRateLimit: crPull, rateLimitReply: rlrPull } = await import('../lib/rateLimit');
    const rlPull = crPull(req as any, 'fetch', 10, 60 * 1000);
    if (!rlPull.allowed) return rlrPull(reply as any, rlPull.resetMs);

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const storedPullUrl = await getStoredRemoteUrl(repoPath, remote);
    if (!storedPullUrl) return reply.status(404).send({ error: 'remote not found' });
    const storedPullErr = validateRemoteUrl(storedPullUrl);
    if (storedPullErr) {
      try {
        await auditLog({ userId: user.id, action: 'ssrf.blocked', target: `${owner}/${repo}:${remote}`, req });
      } catch {}
      return reply.status(403).send({ error: `remote blocked: ${storedPullErr} (remove and re-add the remote)` });
    }
    const args = ['pull', remote];
    if (branch) args.push(branch);
    const res = await execItehaas(args, { cwd: repoPath });
    if (res.code !== 0) return reply.status(500).send({ error: res.stderr || res.stdout });
    return reply.send({ ok: true, remote, output: res.stdout.trim() });
  });

  // Remote management: list/add/remove remotes via VCS config
  app.get('/api/repos/:owner/:repo/remotes', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const user = await getSessionUser(req as any);
    const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(r.rows[0].id, user?.id ?? null, r.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const res = await execItehaas(['remote', '-v'], { cwd: repoPath });
    if (res.code !== 0) return reply.status(500).send({ error: res.stderr });
    // Parse lines like "origin file:///tmp/x (fetch)"
    const remotes: { name: string; url: string }[] = [];
    for (const line of res.stdout.split('\n')) {
      const m = line.trim().match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (m) remotes.push({ name: m[1], url: m[2] });
    }
    return reply.send({ remotes });
  });

  app.post('/api/repos/:owner/:repo/remotes', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    // S14: remote config changes trigger network egress — 20/min.
    const { checkRateLimit: crRemotes, rateLimitReply: rlrRemotes } = await import('../lib/rateLimit');
    const rlRemotes = crRemotes(req as any, 'remotes', 20, 60 * 1000);
    if (!rlRemotes.allowed) return rlrRemotes(reply as any, rlRemotes.resetMs);
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await isAdmin(r.rows[0].id, user.id))) return reply.status(403).send({ error: 'forbidden' });

    const schema = z.object({ name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/), url: z.string().min(1).max(500) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { name, url } = parsed.data;
    // S5-fresh: remote name flows positionally into `remote add <name>` — leading-dash
    // names (e.g. --help) would parse as CLI flags. Reject (matches DELETE guard).
    if (name.startsWith('-') || name.startsWith('.')) {
      return reply.status(400).send({ error: 'invalid remote name' });
    }

    // S13: shared remote-URL policy (creation-time gate; execution-time re-check
    // in fetch/push/pull covers stale remotes predating this gate).
    const urlErr = validateRemoteUrl(url);
    if (urlErr) {
      try {
        await auditLog({ userId: user.id, action: 'ssrf.blocked', target: `${owner}/${repo}:${name}`, req });
      } catch {}
      return reply.status(400).send({ error: urlErr });
    }
    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const res = await execItehaas(['remote', 'add', name, url], { cwd: repoPath });
    if (res.code !== 0) {
      if (res.stderr.includes('already exists')) return reply.status(409).send({ error: res.stderr.trim() });
      return reply.status(500).send({ error: res.stderr });
    }
    return reply.status(201).send({ ok: true, name, url });
  });

  app.delete('/api/repos/:owner/:repo/remotes/:name', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { checkRateLimit: crRemotesDel, rateLimitReply: rlrRemotesDel } = await import('../lib/rateLimit');
    const rlRemotesDel = crRemotesDel(req as any, 'remotes', 20, 60 * 1000);
    if (!rlRemotesDel.allowed) return rlrRemotesDel(reply as any, rlRemotesDel.resetMs);
    const { owner, repo, name } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    // S5-fresh: remote name flows positionally into `remote remove <name>` — a value
    // like `--help` would otherwise be parsed as a CLI flag (integrity confusion).
    // Leading dots are rejected too (hidden/ref confusion).
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name) || name.startsWith('-') || name.startsWith('.')) {
      return reply.status(400).send({ error: 'invalid remote name' });
    }
    const r = await query(`SELECT r.id FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (r.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await isAdmin(r.rows[0].id, user.id))) return reply.status(403).send({ error: 'forbidden' });

    let repoPath: string;
    try { repoPath = repoPathFor(owner, repo); } catch (e: any) { return reply.status(400).send({ error: e.message }); }
    const res = await execItehaas(['remote', 'remove', name], { cwd: repoPath });
    if (res.code !== 0) return reply.status(500).send({ error: res.stderr });
    return reply.send({ ok: true });
  });
}
