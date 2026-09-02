import { query } from '../db';

export async function isOwner(repoId: string, userId: string): Promise<boolean> {
  const res = await query(`SELECT owner_id FROM repositories WHERE id = $1`, [repoId]);
  return res.rows[0]?.owner_id === userId;
}

export async function getMemberRole(repoId: string, userId: string): Promise<string | null> {
  const res = await query(`SELECT role FROM repository_members WHERE repo_id = $1 AND user_id = $2`, [repoId, userId]);
  return res.rows[0]?.role ?? null;
}

export async function getTeamPermission(repoId: string, userId: string): Promise<string | null> {
  const res = await query(
    `SELECT tr.permission FROM team_members tm JOIN team_repositories tr ON tm.team_id = tr.team_id WHERE tm.user_id = $1 AND tr.repo_id = $2`,
    [userId, repoId]
  );
  if (res.rows.length === 0) return null;
  // Return highest permission among teams
  const order: Record<string, number> = { read: 1, write: 2, admin: 3 };
  let best: string | null = null;
  let max = 0;
  for (const r of res.rows) {
    const v = order[r.permission] ?? 0;
    if (v > max) {
      max = v;
      best = r.permission;
    }
  }
  return best;
}

export async function canRead(repoId: string, userId: string | null, visibility: string): Promise<boolean> {
  if (visibility === 'public') return true;
  if (!userId) return false;
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  if (role !== null) return true;
  const teamPerm = await getTeamPermission(repoId, userId);
  return teamPerm !== null;
}

export async function canWrite(repoId: string, userId: string): Promise<boolean> {
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  if (role === 'write' || role === 'admin') return true;
  const teamPerm = await getTeamPermission(repoId, userId);
  return teamPerm === 'write' || teamPerm === 'admin';
}

export async function isAdmin(repoId: string, userId: string): Promise<boolean> {
  if (await isOwner(repoId, userId)) return true;
  const role = await getMemberRole(repoId, userId);
  if (role === 'admin') return true;
  const teamPerm = await getTeamPermission(repoId, userId);
  return teamPerm === 'admin';
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
