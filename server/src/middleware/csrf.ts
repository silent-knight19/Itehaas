import * as crypto from 'crypto';
import { sessionCookieName, csrfTokenForSession } from '../lib/auth';
import { config } from '../config';

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
      const devOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
      ];
      const prodOrigins = ['https://itehaas.tailnet.ts.net', 'https://itehaas.local'];
      const allowed = process.env.ALLOWED_ORIGIN
        ? process.env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
        : config.isProd
          ? prodOrigins
          : [...devOrigins, ...prodOrigins];

      if (!allowed.includes(origin)) {
        return reply.status(403).send({ error: 'cross-origin request forbidden' });
      }
    }
  }

  const headerToken = (req.headers['x-csrf-token'] as string | undefined) || (req.headers['x-xsrf-token'] as string | undefined);
  const cookieToken = (req.cookies as any)?.['csrf_token'] as string | undefined;

  // SEC-004: In production, fail-closed unconditionally.
  // In development/test, allow missing csrf_token cookie for backward-compatible test injection.
  if (!config.isProd && !cookieToken && !headerToken) return;

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
