import { query } from '../db';
import { sessionCookieName } from '../lib/auth';

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
}

/**
 * Extract session user if present, else null. Validates expiry.
 */
export async function getSessionUser(req: any): Promise<AuthUser | null> {
  const sessionId = (req.cookies as any)?.[sessionCookieName()];
  if (!sessionId) return null;
  // Basic UUID format guard to avoid DB hit on garbage
  if (!/^[0-9a-fA-F-]{36}$/.test(sessionId)) return null;
  const res = await query(
    `SELECT u.id, u.username, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0] as AuthUser;
}

export async function requireAuth(req: any, reply: any): Promise<AuthUser | null> {
  const user = await getSessionUser(req);
  if (!user) {
    reply.status(401).send({ error: 'not authenticated' });
    return null;
  }
  return user;
}

/**
 * Cleanup expired sessions (call periodically or on login).
 * Not a cron, just opportunistic.
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await query(`DELETE FROM sessions WHERE expires_at < now()`);
  } catch {
    // ignore
  }
}
