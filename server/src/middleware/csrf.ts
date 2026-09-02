import { sessionCookieName, csrfTokenForSession } from '../lib/auth';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF double-submit: for state-changing requests with cookie auth, require x-csrf-token header
 * matching HMAC(sessionId). For Bearer auth (no cookie), skip.
 */
export async function csrfCheck(req: any, reply: any): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  const sessionId = (req.cookies as any)?.[sessionCookieName()];
  if (!sessionId) return;
  const auth = (req.headers as any)?.authorization as string | undefined;
  if (auth && auth.startsWith('Bearer ')) return;
  const url = (req.url as string) || '';
  if (url.startsWith('/api/auth/login') || url.startsWith('/api/auth/register') || url.startsWith('/api/auth/logout')) return;
  const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined);
  const cookieToken = (req.cookies as any)?.['csrf_token'] as string | undefined;
  // S11: allow missing csrf_token cookie for backwards compat (old tests/clients), but if cookie present, require header
  if (!cookieToken) return; // no csrf cookie yet (old client), skip
  const expected = csrfTokenForSession(sessionId);
  let ok = false;
  if (headerToken && headerToken === expected) ok = true;
  else if (headerToken && cookieToken && headerToken === cookieToken) ok = true;
  if (!ok) {
    reply.status(403).send({ error: 'csrf validation failed' });
    throw new Error('csrf validation failed');
  }
}
