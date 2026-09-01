import * as argon2 from 'argon2';
import { v4 as uuid } from 'uuid';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

const RESERVED_USERNAMES = new Set([
  'login',
  'register',
  'api',
  'health',
  'settings',
  'explore',
  '_next',
  'admin',
  'root',
  'owner',
  'repo',
]);

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(username.toLowerCase());
}

export function validateUsername(username: string): string | null {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return 'username must be 3-32 chars, alphanumeric + ._-';
  }
  if (isReservedUsername(username)) {
    return 'username is reserved';
  }
  return null;
}

export function validateBio(bio: string): string | null {
  if (bio.length > 160) return 'bio must be at most 160 characters';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'password must be at least 8 characters';
  if (password.length > 128) return 'password too long';
  return null;
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'invalid email';
  if (email.length > 255) return 'email too long';
  return null;
}

export function sessionCookieName() {
  return 'itehaas_session';
}

export function newSessionExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 30); // 30 days
  return d;
}

export function validateSessionId(sid: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(sid);
}

// CSRF: SameSite=lax is primary defense. For state-changing API calls,
// we also accept optional X-CSRF-Token header if client opts in.
// Token is not required in Phase 6 (web not yet), but helper is provided.
export function csrfTokenForSession(sessionId: string): string {
  // Simple HMAC-like: not cryptographically strong, but deterministic per session for Phase 6
  // In production, replace with signed token via cookieSecret.
  return Buffer.from(sessionId).toString('base64url').slice(0, 32);
}
