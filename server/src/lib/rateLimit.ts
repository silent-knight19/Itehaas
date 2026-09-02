// Simple in-memory rate limiter for auth (S2). No Redis yet — resets on restart (acceptable for single laptop).
// Per-IP + per-key (e.g., username) limits. Used by S2 auth, extended in S14 for global.

type Bucket = { count: number; resetMs: number };

const buckets = new Map<string, Bucket>();

function keyFor(req: any, suffix: string): string {
  const ip = (req.ip as string) || (req.headers['x-forwarded-for'] as string) || (req.headers['x-real-ip'] as string) || 'unknown';
  // x-forwarded-for may contain list, take first
  const cleanIp = String(ip).split(',')[0].trim().slice(0, 80);
  return `${cleanIp}:${suffix}`;
}

/**
 * Check and increment. Returns true if allowed, false if rate-limited.
 * Window is sliding reset: first hit sets resetMs = now+windowMs.
 */
export function checkRateLimit(req: any, suffix: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetMs: number } {
  const k = keyFor(req, suffix);
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now >= b.resetMs) {
    b = { count: 1, resetMs: now + windowMs };
    buckets.set(k, b);
    return { allowed: true, remaining: max - 1, resetMs: b.resetMs };
  }
  if (b.count >= max) {
    return { allowed: false, remaining: 0, resetMs: b.resetMs };
  }
  b.count++;
  return { allowed: true, remaining: max - b.count, resetMs: b.resetMs };
}

export function rateLimitReply(reply: any, resetMs: number) {
  const retryAfterSec = Math.ceil((resetMs - Date.now()) / 1000);
  reply.header('Retry-After', String(Math.max(1, retryAfterSec)));
  return reply.status(429).send({ error: 'too many requests, retry later' });
}

// For testing: allow clearing
export function __clearRateLimitBuckets() {
  buckets.clear();
}

// Brute-force lockout per username+ip: separate map with longer window
const loginFails = new Map<string, { fails: number; lockUntilMs: number }>();

export function isLoginLocked(req: any, username: string): boolean {
  const k = keyFor(req, `login-fails:${username.toLowerCase()}`);
  const e = loginFails.get(k);
  // debug
  // console.log('[isLoginLocked]', k, e);
  if (!e) return false;
  if (e.lockUntilMs !== 0 && Date.now() >= e.lockUntilMs) {
    loginFails.delete(k);
    return false;
  }
  if (e.lockUntilMs === 0) return false;
  return true;
}

export function getLoginLockMs(req: any, username: string): number {
  const k = keyFor(req, `login-fails:${username.toLowerCase()}`);
  return loginFails.get(k)?.lockUntilMs ?? 0;
}

export function recordLoginFail(req: any, username: string) {
  const k = keyFor(req, `login-fails:${username.toLowerCase()}`);
  const now = Date.now();
  let e = loginFails.get(k);
  if (!e) {
    e = { fails: 0, lockUntilMs: 0 };
    loginFails.set(k, e);
  } else if (e.lockUntilMs !== 0 && now >= e.lockUntilMs) {
    // expired lock, reset
    loginFails.delete(k);
    e = { fails: 0, lockUntilMs: 0 };
    loginFails.set(k, e);
  }
  e.fails++;
  // After 5 fails, lock 15m
  if (e.fails >= 5) {
    e.lockUntilMs = now + 15 * 60 * 1000;
  }
}

export function clearLoginFails(req: any, username: string) {
  const k = keyFor(req, `login-fails:${username.toLowerCase()}`);
  loginFails.delete(k);
}

export function __clearLoginFails() {
  loginFails.clear();
}
