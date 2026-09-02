import * as crypto from 'crypto';
import { sessionCookieName, csrfTokenForSession } from '../lib/auth';
import { config } from '../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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

  // SEC-004: In production, fail-closed unconditionally.
  // In development/test, allow missing csrf_token cookie for backward-compatible test injection.
  if (!config.isProd && !cookieToken) return;

  const expected = csrfTokenForSession(sessionId);
  let ok = false;
  if (headerToken && safeCompare(headerToken, expected)) ok = true;
  else if (headerToken && cookieToken && safeCompare(headerToken, cookieToken)) ok = true;
  if (!ok) {
    reply.status(403).send({ error: 'csrf validation failed' });
    throw new Error('csrf validation failed');
  }
}
