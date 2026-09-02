import { FastifyInstance } from 'fastify';
import { query } from '../db';
import { getSessionUser, requireAuth } from '../middleware/auth';
import { canRead } from '../lib/permissions';

function validateOwnerRepo(o: string, r: string) {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(o) && /^[a-zA-Z0-9._-]{1,100}$/.test(r);
}

export async function starRoutes(app: FastifyInstance) {
  // Star
  app.post('/api/repos/:owner/:repo/star', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (meta.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.rows[0].id, user.id, meta.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    try {
      await query(`INSERT INTO stars (user_id, repo_id) VALUES ($1,$2)`, [user.id, meta.rows[0].id]);
    } catch (e: any) {
      if (e.code === '23505') return reply.status(200).send({ ok: true, starred: true });
      throw e;
    }
    await query(`INSERT INTO activity (repo_id, user_id, action, payload) VALUES ($1,$2,'star',$3)`, [meta.rows[0].id, user.id, JSON.stringify({ repo: `${owner}/${repo}` })]);
    return reply.send({ ok: true, starred: true });
  });

  app.delete('/api/repos/:owner/:repo/star', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { owner, repo } = req.params as any;
    const meta = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (meta.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    if (!(await canRead(meta.rows[0].id, user.id, meta.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    await query(`DELETE FROM stars WHERE user_id=$1 AND repo_id=$2`, [user.id, meta.rows[0].id]);
    return reply.send({ ok: true, starred: false });
  });

  app.get('/api/repos/:owner/:repo/stars', async (req, reply) => {
    const { owner, repo } = req.params as any;
    const meta = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (meta.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.rows[0].id, user?.id ?? null, meta.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    const countRes = await query(`SELECT count(*)::int as count FROM stars WHERE repo_id=$1`, [meta.rows[0].id]);
    let starred = false;
    if (user) {
      const s = await query(`SELECT 1 FROM stars WHERE user_id=$1 AND repo_id=$2`, [user.id, meta.rows[0].id]);
      starred = s.rows.length > 0;
    }
    return reply.send({ count: countRes.rows[0].count, starred });
  });

  // Notifications
  app.get('/api/notifications', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const res = await query(`SELECT id, type, payload, is_read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [user.id]);
    return reply.send({ notifications: res.rows });
  });

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { id } = req.params as any;
    await query(`UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2`, [id, user.id]);
    return reply.send({ ok: true });
  });

  app.get('/api/activity/:owner/:repo', async (req, reply) => {
    const { owner, repo } = req.params as any;
    if (!validateOwnerRepo(owner, repo)) return reply.status(400).send({ error: 'invalid' });
    const meta = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
    if (meta.rows.length === 0) return reply.status(404).send({ error: 'not found' });
    const user = await getSessionUser(req as any);
    if (!(await canRead(meta.rows[0].id, user?.id ?? null, meta.rows[0].visibility))) return reply.status(404).send({ error: 'not found' });
    const res = await query(`SELECT a.action, a.payload, a.created_at, u.username FROM activity a LEFT JOIN users u ON a.user_id=u.id WHERE a.repo_id=$1 ORDER BY a.created_at DESC LIMIT 50`, [meta.rows[0].id]);
    return reply.send({ activity: res.rows });
  });
}
