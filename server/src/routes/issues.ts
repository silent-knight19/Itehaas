import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead, canWrite } from '../lib/permissions';

function validateOwnerRepo(owner: string, repo: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(owner) && /^[a-zA-Z0-9._-]{1,100}$/.test(repo);
}

async function getRepoId(owner: string, repo: string) {
  const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (r.rows.length === 0) return null;
  return r.rows[0] as { id: string; visibility: string };
}

export async function issueRoutes(app: FastifyInstance) {
  // List issues
  app.get('/api/repos/:owner/:repo/issues', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const { status } = req.query as any;
    const where = status ? `AND status=$2` : '';
    const params = status ? [repoMeta.id, status] : [repoMeta.id];
    const res = await query(`SELECT i.id, i.title, i.body, i.status, i.created_at, i.updated_at, u.username as author FROM issues i JOIN users u ON i.author_id=u.id WHERE repo_id=$1 ${where} ORDER BY updated_at DESC`, params);
    return reply.send({ issues: res.rows });
  });

  // Create issue
  app.post('/api/repos/:owner/:repo/issues', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(repoMeta.id, user.id, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    // need at least read to create issue; write not required per GitHub? We'll allow read.
    const schema = z.object({ title: z.string().min(1).max(200), body: z.string().max(5000).optional().default('') });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const { title, body } = parsed.data;
    const res = await query(`INSERT INTO issues (repo_id, author_id, title, body) VALUES ($1,$2,$3,$4) RETURNING id, title, body, status, created_at`, [repoMeta.id, user.id, title, body]);
    await query(`INSERT INTO activity (repo_id, user_id, action, payload) VALUES ($1,$2,'issue_open', $3)`, [repoMeta.id, user.id, JSON.stringify({ issue_id: res.rows[0].id, title })]);
    return reply.status(201).send({ issue: res.rows[0] });
  });

  // Get single issue
  app.get('/api/repos/:owner/:repo/issues/:id', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid owner/repo' });
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT i.id, i.title, i.body, i.status, i.created_at, i.updated_at, u.username as author FROM issues i JOIN users u ON i.author_id=u.id WHERE i.id=$1 AND i.repo_id=$2`, [id, repoMeta.id]);
    if (res.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    return reply.send({ issue: res.rows[0] });
  });

  // Update issue (close/reopen, title/body)
  app.patch('/api/repos/:owner/:repo/issues/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    // Only author or writer can update
    const issue = await query(`SELECT author_id, repo_id FROM issues WHERE id=$1`, [id]);
    if (issue.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const isAuthor = issue.rows[0].author_id === user.id;
    const canW = await canWrite(repoMeta.id, user.id);
    if (!isAuthor && !canW) return reply.status(403).send({ error: 'forbidden' });
    const schema = z.object({ title: z.string().min(1).max(200).optional(), body: z.string().max(5000).optional(), status: z.enum(['open','closed']).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const fields: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (parsed.data.title !== undefined) { fields.push(`title=$${idx++}`); vals.push(parsed.data.title); }
    if (parsed.data.body !== undefined) { fields.push(`body=$${idx++}`); vals.push(parsed.data.body); }
    if (parsed.data.status !== undefined) { fields.push(`status=$${idx++}`); vals.push(parsed.data.status); }
    if (fields.length === 0) return reply.status(400).send({ error: 'no fields' });
    vals.push(id);
    const res = await query(`UPDATE issues SET ${fields.join(', ')}, updated_at=now() WHERE id=$${idx} RETURNING id, title, body, status, updated_at`, vals);
    return reply.send({ issue: res.rows[0] });
  });

  // Comments
  app.get('/api/repos/:owner/:repo/issues/:id/comments', async (req, reply) => {
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(repoMeta.id, user?.id ?? null, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT c.id, c.body, c.created_at, u.username as author FROM issue_comments c JOIN users u ON c.author_id=u.id WHERE c.issue_id=$1 ORDER BY c.created_at`, [id]);
    return reply.send({ comments: res.rows });
  });

  app.post('/api/repos/:owner/:repo/issues/:id/comments', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo, id } = req.params as any;
    const repoMeta = await getRepoId(owner, repo);
    if (!repoMeta) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(repoMeta.id, user.id, repoMeta.visibility))) return reply.status(404).send({ error: 'not found' });
    const schema = z.object({ body: z.string().min(1).max(5000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues[0].message });
    const exists = await query(`SELECT id FROM issues WHERE id=$1 AND repo_id=$2`, [id, repoMeta.id]);
    if (exists.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const res = await query(`INSERT INTO issue_comments (issue_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at`, [id, user.id, parsed.data.body]);
    return reply.status(201).send({ comment: { ...res.rows[0], author: user.username } });
  });
}
