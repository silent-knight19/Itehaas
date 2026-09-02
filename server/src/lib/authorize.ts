// S3: central authorize helper — DRY for 404-mask private repos
import { query } from '../db';
import { canRead, canWrite, isAdmin } from './permissions';
import { getSessionUser } from '../middleware/auth';

export async function authorizeRepo(
  req: any,
  reply: any,
  owner: string,
  repo: string,
  level: 'read' | 'write' | 'admin'
): Promise<{ repoId: string; visibility: string } | null> {
  const r = await query(`SELECT r.id, r.visibility FROM repositories r JOIN users u ON r.owner_id=u.id WHERE u.username=$1 AND r.name=$2`, [owner, repo]);
  if (r.rows.length === 0) {
    reply.status(404).send({ error: 'not found' });
    return null;
  }
  const { id: repoId, visibility } = r.rows[0];
  const user = await getSessionUser(req);
  const userId = user?.id ?? null;
  let ok = false;
  if (level === 'read') ok = await canRead(repoId, userId, visibility);
  else if (level === 'write') {
    if (!userId) { reply.status(401).send({ error: 'not authenticated' }); return null; }
    ok = await canWrite(repoId, userId);
  } else if (level === 'admin') {
    if (!userId) { reply.status(401).send({ error: 'not authenticated' }); return null; }
    ok = await isAdmin(repoId, userId);
  }
  if (!ok) {
    // 404-mask for read, 403 for write/admin if private but user exists
    if (level === 'read') reply.status(404).send({ error: 'not found' });
    else reply.status(403).send({ error: 'forbidden' });
    return null;
  }
  return { repoId, visibility };
}
