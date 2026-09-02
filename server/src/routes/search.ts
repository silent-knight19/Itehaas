import { FastifyInstance } from 'fastify';
import { query } from '../db';
import { getSessionUser } from '../middleware/auth';

export async function searchRoutes(app: FastifyInstance) {
  // Global search: GET /api/search?q=hello&type=repos|issues|pulls|users&limit=20
  app.get('/api/search', async (req, reply) => {
    const { q, type, limit, offset } = req.query as any;
    if (!q || typeof q !== 'string' || q.trim().length < 2) return reply.status(400).send({ error: 'query too short (min 2 chars)' });
    const search = `%${q.trim()}%`;
    const lim = Math.min(Math.max(parseInt(limit ?? '20', 10) || 20, 1), 50);
    const off = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    const t = (type as string | undefined)?.toLowerCase();
    const user = await getSessionUser(req as any);
    const userId = user?.id ?? null;

    const results: any = {};

    if (!t || t === 'repos' || t === 'repositories') {
      // Repositories: name ILIKE or description ILIKE, with visibility filter
      let sql: string;
      let params: any[];
      if (userId) {
        sql = `SELECT r.id, r.name, r.description, r.visibility, r.updated_at, u.username as owner
               FROM repositories r JOIN users u ON r.owner_id=u.id
               WHERE (r.visibility='public' OR r.owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1))
                 AND (r.name ILIKE $2 OR r.description ILIKE $2 OR u.username ILIKE $2)
               ORDER BY r.updated_at DESC LIMIT $${3} OFFSET $${4}`;
        params = [userId, search, lim, off];
      } else {
        sql = `SELECT r.id, r.name, r.description, r.visibility, r.updated_at, u.username as owner
               FROM repositories r JOIN users u ON r.owner_id=u.id
               WHERE r.visibility='public' AND (r.name ILIKE $1 OR r.description ILIKE $1 OR u.username ILIKE $1)
               ORDER BY r.updated_at DESC LIMIT $2 OFFSET $3`;
        params = [search, lim, off];
      }
      const res = await query(sql, params);
      results.repositories = res.rows;
    }

    if (!t || t === 'issues') {
      let sql: string;
      let params: any[];
      if (userId) {
        sql = `SELECT i.id, i.title, i.body, i.status, i.repo_id, r.name as repo, u.username as repo_owner
               FROM issues i JOIN repositories r ON i.repo_id=r.id JOIN users u ON r.owner_id=u.id
               WHERE (r.visibility='public' OR r.owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1))
                 AND (i.title ILIKE $2 OR i.body ILIKE $2)
               ORDER BY i.updated_at DESC LIMIT $${3} OFFSET $${4}`;
        params = [userId, search, lim, off];
      } else {
        sql = `SELECT i.id, i.title, i.body, i.status, i.repo_id, r.name as repo, u.username as repo_owner
               FROM issues i JOIN repositories r ON i.repo_id=r.id JOIN users u ON r.owner_id=u.id
               WHERE r.visibility='public' AND (i.title ILIKE $1 OR i.body ILIKE $1)
               ORDER BY i.updated_at DESC LIMIT $2 OFFSET $3`;
        params = [search, lim, off];
      }
      const res = await query(sql, params);
      results.issues = res.rows;
    }

    if (!t || t === 'pulls' || t === 'prs') {
      let sql: string;
      let params: any[];
      if (userId) {
        sql = `SELECT pr.id, pr.title, pr.body, pr.status, pr.repo_id, r.name as repo, u.username as repo_owner
               FROM pull_requests pr JOIN repositories r ON pr.repo_id=r.id JOIN users u ON r.owner_id=u.id
               WHERE (r.visibility='public' OR r.owner_id=$1 OR EXISTS (SELECT 1 FROM repository_members m WHERE m.repo_id=r.id AND m.user_id=$1))
                 AND (pr.title ILIKE $2 OR pr.body ILIKE $2)
               ORDER BY pr.updated_at DESC LIMIT $${3} OFFSET $${4}`;
        params = [userId, search, lim, off];
      } else {
        sql = `SELECT pr.id, pr.title, pr.body, pr.status, pr.repo_id, r.name as repo, u.username as repo_owner
               FROM pull_requests pr JOIN repositories r ON pr.repo_id=r.id JOIN users u ON r.owner_id=u.id
               WHERE r.visibility='public' AND (pr.title ILIKE $1 OR pr.body ILIKE $1)
               ORDER BY pr.updated_at DESC LIMIT $2 OFFSET $3`;
        params = [search, lim, off];
      }
      const res = await query(sql, params);
      results.pulls = res.rows;
    }

    if (!t || t === 'users') {
      const res = await query(`SELECT id, username, bio FROM users WHERE username ILIKE $1 OR bio ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [search, lim, off]);
      results.users = res.rows;
    }

    // Code search via pg_trgm on file content? For MVP, we search commit messages and file names via `git grep` like? We can't search file content in DB, so we return empty for code type but handle via `type=code` that searches issues/pulls already
    // For code search, we could search in `activity` payload or just return empty
    if (t === 'code') {
      // Search in commit messages via `activity`? Not accurate, but we can search in pull_requests title/body as code
      results.code = results.pulls || [];
    }

    return reply.send({ query: q, results });
  });
}
