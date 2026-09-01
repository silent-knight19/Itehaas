import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../db';
import { config } from '../config';
import { repoPathFor, execItehaas } from '../lib/vcs';
import { sessionCookieName } from '../lib/auth';

async function requireAuth(req: any, reply: any) {
  const sessionId = req.cookies[sessionCookieName()];
  if (!sessionId) {
    reply.status(401).send({ error: 'not authenticated' });
    return null;
  }
  const res = await query(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  if (res.rows.length === 0) {
    reply.status(401).send({ error: 'session expired' });
    return null;
  }
  return res.rows[0] as { id: string; username: string };
}

async function canRead(repoId: string, userId: string | null, visibility: string): Promise<boolean> {
  if (visibility === 'public') return true;
  if (!userId) return false;
  const res = await query(`SELECT 1 FROM repository_members WHERE repo_id = $1 AND user_id = $2`, [repoId, userId]);
  if (res.rows.length > 0) return true;
  const owner = await query(`SELECT owner_id FROM repositories WHERE id = $1`, [repoId]);
  return owner.rows[0]?.owner_id === userId;
}

export async function repoRoutes(app: FastifyInstance) {
  // Create repo
  app.post('/api/repos', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;

    const schema = z.object({
      name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
      description: z.string().max(500).optional().default(''),
      visibility: z.enum(['public', 'private']).default('private'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { name, description, visibility } = parsed.data;

    // Check existing
    const exists = await query(`SELECT id FROM repositories WHERE owner_id = $1 AND name = $2`, [user.id, name]);
    if (exists.rows.length > 0) return reply.status(409).send({ error: 'repository already exists' });

    const repoRes = await query(
      `INSERT INTO repositories (owner_id, name, description, visibility) VALUES ($1, $2, $3, $4) RETURNING id, name, description, visibility, default_branch, created_at`,
      [user.id, name, description, visibility]
    );
    const repo = repoRes.rows[0];

    // Add owner as admin member
    await query(`INSERT INTO repository_members (repo_id, user_id, role) VALUES ($1, $2, 'admin')`, [repo.id, user.id]);

    // Create VCS repo on filesystem
    const repoPath = repoPathFor(user.username, name);
    try {
      await fs.promises.mkdir(path.dirname(repoPath), { recursive: true });
      const res = await execItehaas(['init', repoPath]);
      if (res.code !== 0) {
        // Rollback DB
        await query(`DELETE FROM repositories WHERE id = $1`, [repo.id]);
        return reply.status(500).send({ error: `vcs init failed: ${res.stderr}` });
      }
      // Ensure hasher is sha256 (default)
    } catch (e: any) {
      await query(`DELETE FROM repositories WHERE id = $1`, [repo.id]);
      return reply.status(500).send({ error: e.message });
    }

    return reply.status(201).send({ repo: { ...repo, owner: user.username } });
  });

  // List repos (public + user's)
  app.get('/api/repos', async (req, reply) => {
    const sessionId = (req.cookies as any)[sessionCookieName()];
    let userId: string | null = null;
    if (sessionId) {
      const r = await query(`SELECT user_id FROM sessions WHERE id = $1 AND expires_at > now()`, [sessionId]);
      if (r.rows.length > 0) userId = r.rows[0].user_id;
    }

    const q = userId
      ? `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, u.username as owner
         FROM repositories r JOIN users u ON r.owner_id = u.id
         WHERE r.visibility = 'public' OR r.owner_id = $1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id = r.id AND m.user_id = $1)
         ORDER BY r.updated_at DESC LIMIT 100`
      : `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, u.username as owner
         FROM repositories r JOIN users u ON r.owner_id = u.id WHERE r.visibility = 'public' ORDER BY r.updated_at DESC LIMIT 100`;

    const params = userId ? [userId] : [];
    const res = await query(q, params);
    return reply.send({ repos: res.rows });
  });

  // Get single repo
  app.get('/api/repos/:owner/:repo', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const sessionId = (req.cookies as any)[sessionCookieName()];
    let userId: string | null = null;
    if (sessionId) {
      const r = await query(`SELECT user_id FROM sessions WHERE id = $1 AND expires_at > now()`, [sessionId]);
      if (r.rows.length > 0) userId = r.rows[0].user_id;
    }

    const res = await query(
      `SELECT r.id, r.name, r.description, r.visibility, r.default_branch, r.created_at, r.updated_at, u.username as owner, u.id as owner_id
       FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const row = res.rows[0];
    const ok = await canRead(row.id, userId, row.visibility);
    if (!ok) return reply.status(404).send({ error: 'not found' });

    // Try to get HEAD info via VCS
    let head: string | null = null;
    let branches: string[] = [];
    try {
      const repoPath = repoPathFor(owner, repo);
      const headRes = await execItehaas(['log', '--oneline'], { cwd: repoPath });
      // Not needed for now
    } catch {}

    return reply.send({ repo: row });
  });

  // Delete repo (owner only)
  app.delete('/api/repos/:owner/:repo', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (owner !== user.username) return reply.status(403).send({ error: 'forbidden' });

    const res = await query(
      `SELECT r.id FROM repositories r JOIN users u ON r.owner_id = u.id WHERE u.username = $1 AND r.name = $2`,
      [owner, repo]
    );
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const repoId = res.rows[0].id;

    await query(`DELETE FROM repositories WHERE id = $1`, [repoId]);

    const repoPath = repoPathFor(owner, repo);
    try {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
    } catch {}

    return reply.send({ ok: true });
  });

  // List refs / branches via VCS
  app.get('/api/repos/:owner/:repo/branches', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const repoPath = repoPathFor(owner, repo);
    const res = await execItehaas(['branch'], { cwd: repoPath });
    if (res.code !== 0) return reply.status(500).send({ error: res.stderr });
    // Parse "  main\n* feature\n"
    const branches = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\*\s*/, '').trim());
    return reply.send({ branches });
  });

  // Get commit log
  app.get('/api/repos/:owner/:repo/log', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const repoPath = repoPathFor(owner, repo);
    const res = await execItehaas(['log', '--oneline'], { cwd: repoPath });
    if (res.code !== 0) {
      // No commits yet returns error "no commits yet" — treat as empty
      if (res.stderr.includes('no commits yet')) return reply.send({ commits: [] });
      return reply.status(500).send({ error: res.stderr });
    }
    const commits = res.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ...msg] = line.split(' ');
        return { hash, message: msg.join(' ') };
      });
    return reply.send({ commits });
  });

  // Get tree / file via VCS (simple)
  app.get('/api/repos/:owner/:repo/tree/:hash', async (req, reply) => {
    const { owner, repo, hash } = req.params as any;
    const repoPath = repoPathFor(owner, repo);
    const res = await execItehaas(['cat-file', '-p', hash], { cwd: repoPath });
    if (res.code !== 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ content: res.stdout });
  });
}
