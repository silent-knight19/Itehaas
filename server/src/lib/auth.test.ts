import { describe, it, expect } from 'vitest';
import { validateUsername, validatePassword, validateEmail, sessionCookieName, newSessionExpiry } from './auth';

describe('auth validators', () => {
  it('validateUsername valid', () => {
    expect(validateUsername('alice')).toBeNull();
    expect(validateUsername('bob_123')).toBeNull();
    expect(validateUsername('a.b-c')).toBeNull();
  });
  it('validateUsername invalid', () => {
    expect(validateUsername('ab')).not.toBeNull(); // too short
    expect(validateUsername('a'.repeat(33))).not.toBeNull();
    expect(validateUsername('bad user')).not.toBeNull();
    expect(validateUsername('bad/slash')).not.toBeNull();
  });
  it('validatePassword', () => {
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('longenough123')).toBeNull();
    expect(validatePassword('a'.repeat(129))).not.toBeNull();
  });
  it('validateEmail', () => {
    expect(validateEmail('notanemail')).not.toBeNull();
    expect(validateEmail('a@b.c')).toBeNull();
    expect(validateEmail('test@example.com')).toBeNull();
  });
  it('sessionCookieName', () => {
    expect(sessionCookieName()).toBe('itehaas_session');
  });
  it('newSessionExpiry 30 days future', () => {
    const e = newSessionExpiry();
    const diff = e.getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(diff).toBeLessThan(31 * 24 * 3600 * 1000);
  });
});
