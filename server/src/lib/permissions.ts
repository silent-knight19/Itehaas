import { query } from '../db';

export async function isOwner(repoId: string, userId: string): Promise<boolean> {
  const res = await query(`SELECT owner_id FROM repositories WHERE id = $1`, [repoId]);
  return res.rows[0]?.owner_id === userId;
}

export async function getMemberRole(repoId: string, userId: string): Promise<string | null> {
  const res = await query(`SELECT role FROM repository_members WHERE repo_id = $1 AND user_id = $2`, [repoId, userId]);
  return res.rows[0]?.role ?? null;
}

export async function canRead(repoId: string, userId: string | null, visibility: string): Promise<boolean> {
  if (visibility === 'public') return true;
  if (!userId) return false;
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  return role !== null; // any role grants read
}

export async function canWrite(repoId: string, userId: string): Promise<boolean> {
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  return role === 'write' || role === 'admin';
}

export async function isAdmin(repoId: string, userId: string): Promise<boolean> {
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  return role === 'admin';
}

export async function requireRepoAccess(
  repoId: string,
  userId: string | null,
  visibility: string,
  level: 'read' | 'write' | 'admin'
): Promise<boolean> {
  if (level === 'read') return canRead(repoId, userId, visibility);
  if (!userId) return false;
  if (level === 'write') return canWrite(repoId, userId);
  if (level === 'admin') return isAdmin(repoId, userId);
  return false;
}
