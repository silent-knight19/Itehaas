import * as argon2 from 'argon2';
import { v4 as uuid } from 'uuid';
import * as crypto from 'crypto';
import { config } from '../config';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB — Vivobook 3500U ~300ms, vs brute-force 100× harder than default 4 MiB
    timeCost: 3,
    parallelism: 1,
  });
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

const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  'qwertyuiop',
  'admin123',
  'itehaas123',
  'welcome123',
]);

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'password must be at least 8 characters';
  if (password.length > 128) return 'password too long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'password is too common or weak';
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
// HMAC with cookieSecret.
export function csrfTokenForSession(sessionId: string): string {
  try {
    const h = crypto.createHmac('sha256', config.cookieSecret).update(sessionId).digest('base64url');
    return h.slice(0, 32);
  } catch {
    // Return cryptographically secure random token, never leak the session ID
    return crypto.randomBytes(24).toString('base64url');
  }
}
