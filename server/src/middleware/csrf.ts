import * as crypto from 'crypto';
import { sessionCookieName, csrfTokenForSession } from '../lib/auth';
import { config } from '../config';
import { getAllowedOrigins } from '../lib/origins';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * S12/SEC-004: CSRF double-submit protection.
 * For state-changing requests with cookie auth:
 * 1. Requires valid HMAC(sessionId) token in x-csrf-token (or x-xsrf-token) header.
 * 2. If csrf_token cookie is provided, verifies it also matches HMAC(sessionId) (blocks cookie-tossing).
 * 3. Enforces Origin verification when Origin header is present.
 * 4. Protects /api/auth/logout from unauthorized cross-site trigger.
 */
export async function csrfCheck(req: any, reply: any): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;

  const sessionId = (req.cookies as any)?.[sessionCookieName()];
  if (!sessionId) return;

  const auth = (req.headers as any)?.authorization as string | undefined;
  if (auth && auth.startsWith('Bearer ')) return;

  const url = (req.url as string) || '';
  // Login and register are unauthenticated and do not have an active session yet
  if (url.startsWith('/api/auth/login') || url.startsWith('/api/auth/register')) return;

  // Origin verification
  const origin = req.headers['origin'] as string | undefined;
  if (origin) {
    if (origin === 'null') {
      return reply.status(403).send({ error: 'cross-origin request forbidden' });
    }
    const host = req.headers['host'];
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return reply.status(403).send({ error: 'invalid origin' });
    }
    if (host && originHost !== host) {
      // S12-fresh: shared allowlist (same list as CORS — drift would open one
      // boundary while closing the other). Entries are slash-normalized.
      const allowed = getAllowedOrigins(process.env, config.isProd);

      if (!allowed.includes(origin)) {
        return reply.status(403).send({ error: 'cross-origin request forbidden' });
      }
    }
  }

  const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined);
  const cookieToken = (req.cookies as any)?.['csrf_token'] as string | undefined;

  // S12-fresh (FSEC-003): fail closed outside the test suite. The old bypass
  // (`!isProd`) disabled CSRF for ALL of development, so a staging/dev server
  // reachable on the LAN/Tailscale accepted cookie-authed cross-site POSTs.
  // Real clients (web/lib/api.ts) forward the csrf_token cookie as a header, so
  // enforcement works in dev; only automated tests skip it — and flipping isProd
  // on (as prod-simulation tests do) re-arms enforcement immediately.
  if (!config.isProd && config.nodeEnv === 'test' && !cookieToken && !headerToken) return;

  const expected = csrfTokenForSession(sessionId);
  let ok = false;

  // SEC-004: Must strictly match HMAC expected value.
  // Never accept arbitrary matching headerToken === cookieToken without HMAC validation!
  if (headerToken && safeCompare(headerToken, expected)) {
    if (cookieToken) {
      if (safeCompare(cookieToken, expected)) {
        ok = true;
      }
    } else {
      ok = true;
    }
  }

  if (!ok) {
    return reply.status(403).send({ error: 'csrf validation failed' });
  }
}
