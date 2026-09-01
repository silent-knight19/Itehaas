import * as argon2 from 'argon2';
import { v4 as uuid } from 'uuid';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function validateUsername(username: string): string | null {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return 'username must be 3-32 chars, alphanumeric + ._-';
  }
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
