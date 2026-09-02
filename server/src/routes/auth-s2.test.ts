import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExec = vi.fn();

// Reuse same mock pattern as api.test.ts
vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
  query: (...args: any[]) => mockQuery(...args),
  getClient: async () => ({
    query: (...args: any[]) => mockQuery(...args),
    release: () => {},
  }),
  pool: { on: vi.fn() },
  };
});

vi.mock('../lib/vcs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execItehaas: (...args: any[]) => mockExec(...args),
    repoPathFor: (owner: string, repo: string) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) throw new Error('invalid owner/repo');
      return `/tmp/itehaas_test/${owner}/${repo}`;
    },
  };
});

vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '0.0.0.0',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas',
    cookieSecret: 'test-secret-32chars-long-for-tests-123456',
    nodeEnv: 'test',
    isProd: false,
  },
}));

// Need to mock rateLimit to allow clearing, but use real implementation
// Import after mocks
import { buildApp } from '../index';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';
import * as authLib from '../lib/auth';
import * as argon2 from 'argon2';

describe('S2 Authentication Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('SEC-005: login rate limit 5/min per IP → 6th returns 429', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM users WHERE username')) return { rows: [] }; // user not found -> will do dummy verify but still rate limited
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    // 5 allowed (even though they are 401, rate limiter counts them)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: `user${i}`, password: 'wrongwrong123' },
      });
      // first 5 should be 401 (invalid credentials) not 429
      expect(res.statusCode).toBe(401);
    }
    // 6th should be 429 due to rate limit (global login 5/min)
    // Need same IP, different username to avoid lockout per username? Our rate limit is per IP global for login, not per username.
    // So 6th with new username still counts.
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'another', password: 'wrong' },
    });
    expect(res6.statusCode).toBe(429);
    expect(res6.json().error).toMatch(/too many requests/);
    await app.close();
  });

  it('SEC-005: register rate limit 3/min per IP → 4th returns 429', async () => {
    // Mock successful register for first 3
    let call = 0;
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO users')) {
        call++;
        return { rows: [{ id: `u${call}`, username: `alice${call}`, email: `alice${call}@example.com`, created_at: new Date().toISOString() }] };
      }
      if (text.includes('INSERT INTO sessions')) {
        return { rows: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: `alice${i}`, email: `alice${i}@example.com`, password: 'longenough123' },
      });
      expect([201, 400, 409]).toContain(res.statusCode); // first 3 allowed (201)
    }
    const res4 = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice3', email: 'alice3@example.com', password: 'longenough123' },
    });
    expect(res4.statusCode).toBe(429);
    await app.close();
  });

  it('SEC-005/S2-04: brute-force lockout 5 fails → 15m lock per username+ip', async () => {
    // Need real user exists so fails are password mismatches, not user not found
    // Use a valid dummy hash to ensure verify fails but takes time; we mock verify to false
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id, username, email, password_hash')) {
        return { rows: [{ id: 'u1', username: 'bob', email: 'bob@example.com', password_hash: '$argon2id$v=19$m=65536,t=3,p=1$dummy$dummy', created_at: new Date().toISOString() }] };
      }
      return { rows: [], rowCount: 0 };
    });
    // Mock verifyPassword to always false for wrong password
    const spy = vi.spyOn(authLib, 'verifyPassword').mockResolvedValue(false);
    const app = await buildApp();
    // Use unique IP per attempt to avoid global rate limit 5/min interfering with lockout per username+ip?
    // Instead, we set rate limit high for this test by clearing buckets each time except lockout map
    // To isolate lockout, we will not trigger global rate limit: we use same username but each request from same IP
    // Our global login limit is 5/min, so after 5 fails, 6th would be rate-limited not lockout. To test lockout, we clear rate limit buckets before 6th.
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bob', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    }
    // Clear global rate limit so lockout is the reason for 429, not rate limit
    __clearRateLimitBuckets();
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bob', password: 'wrong' },
    });
    expect(res6.statusCode).toBe(429);
    // Accept either lockout or rate limit message (both are 429)
    expect(res6.json().error).toMatch(/too many/);
    spy.mockRestore();
    await app.close();
  });

  it('S2-05: register 409 generic (no enumeration)', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO users')) {
        const e: any = new Error('duplicate');
        e.code = '23505';
        e.detail = 'Key (username)=(alice) already exists.';
        throw e;
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', email: 'alice@example.com', password: 'longenough123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('username or email taken');
    // Should NOT be 'username taken'
    expect(res.json().error).not.toBe('username taken');
    await app.close();
  });

  it('S2-05: argon2 cost is hardened (memoryCost 65536)', async () => {
    // Verify hashPassword uses hardened params by inspecting produced hash string
    const hash = await authLib.hashPassword('test-hardened-password-123');
    // argon2id hash contains $argon2id$v=19$m=65536,t=3,p=1$
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    // Also verify that register still works end-to-end
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO users')) return { rows: [{ id: 'u1', username: 'alice2', email: 'a2@b.c', created_at: new Date().toISOString() }] };
      if (text.includes('INSERT INTO sessions')) return { rows: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice2', email: 'alice2@example.com', password: 'longenough123' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('S2-03 session fixation: known cookie not reused on login', async () => {
    const fakeSession = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const spyVerify = vi.spyOn(authLib, 'verifyPassword').mockResolvedValue(true);
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id, username, email, password_hash')) {
        return { rows: [{ id: 'u1', username: 'alice', email: 'alice@example.com', password_hash: '$argon2id$v=19$m=65536,t=3,p=1$test$hash', created_at: new Date().toISOString() }] };
      }
      if (text.includes('INSERT INTO sessions')) {
        return { rows: [{ id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' }] }; // new session different from fake
      }
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { cookie: `itehaas_session=${fakeSession}` },
      payload: { username: 'alice', password: 'correct123' },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieStr).toBeDefined();
    expect(cookieStr).not.toContain(fakeSession);
    expect(cookieStr).toContain('bbbbbbbb-cccc-dddd-eeee-ffffffffffff');
    spyVerify.mockRestore();
    await app.close();
  });

  it('S2: login timing equalization when user not found (dummy verify)', async () => {
    // Ensure dummy verify path is exercised: when user not found, we still call verifyPassword on dummy hash
    // We spy on verifyPassword and check it was called with dummy hash
    let dummyCalled = false;
    const spy = vi.spyOn(authLib, 'verifyPassword').mockImplementation(async (hash: string, pw: string) => {
      if (hash.includes('m=65536') || hash.includes('dummy')) dummyCalled = true;
      // Return false for dummy to simulate no user
      return false;
    });
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id, username, email, password_hash')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nonexistent', password: 'whatever123' },
    });
    expect(res.statusCode).toBe(401);
    // Verify dummy path was taken: verifyPassword should have been called at least once with dummy
    // Our mock counts, but we need to ensure our code path calls getDummyHash -> verifyPassword
    // Since we mocked verifyPassword, dummyCalled will be set if hash contains m=65536
    // The dummy hash generated in auth.ts is m=65536, so this proves timing equalization
    expect(dummyCalled || spy.mock.calls.length > 0).toBe(true);
    spy.mockRestore();
    await app.close();
  });

  it('SEC-005: trustProxy ensures separate client IPs do not collide on rate limits', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM users WHERE username')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    // Client A sends 5 requests from IP 198.51.100.1
    for (let i = 0; i < 5; i++) {
      const resA = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        payload: { username: `userA${i}`, password: 'wrongpassword' },
      });
      expect(resA.statusCode).toBe(401);
    }
    // 6th request from Client A should be rate limited (429)
    const resA6 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '198.51.100.1' },
      payload: { username: 'userA_extra', password: 'wrongpassword' },
    });
    expect(resA6.statusCode).toBe(429);

    // Client B from IP 198.51.100.2 should NOT be rate limited
    const resB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-forwarded-for': '198.51.100.2' },
      payload: { username: 'userB', password: 'wrongpassword' },
    });
    expect(resB.statusCode).toBe(401);
    await app.close();
  });

  it('S2: validatePassword rejects common weak passwords', () => {
    expect(authLib.validatePassword('password123')).toMatch(/too common or weak/);
    expect(authLib.validatePassword('qwertyuiop')).toMatch(/too common or weak/);
    expect(authLib.validatePassword('12345678')).toMatch(/too common or weak/);
    expect(authLib.validatePassword('itehaas123')).toMatch(/too common or weak/);
    expect(authLib.validatePassword('short')).toMatch(/at least 8 characters/);
    expect(authLib.validatePassword('AStrongAndValidPassword2026!')).toBeNull();
  });

  it('S2: csrfTokenForSession never leaks raw sessionId bytes', () => {
    const sid = '12345678-1234-4321-abcd-123456789abc';
    const token = authLib.csrfTokenForSession(sid);
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThanOrEqual(24);
    // Ensure raw sessionId or its direct base64 representation is not leaked
    expect(token).not.toContain(sid);
    expect(token).not.toContain(Buffer.from(sid).toString('base64url').slice(0, 16));
  });

  it('S2: POST /api/auth/password requires authentication', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { currentPassword: 'old', newPassword: 'new' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('S2: POST /api/auth/password fails with incorrect current password', async () => {
    const hash = await authLib.hashPassword('CorrectOldPassword123!');
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'user-1', username: 'alice', email: 'alice@example.com' }] };
      }
      if (text.includes('SELECT password_hash FROM users WHERE id')) {
        return { rows: [{ password_hash: hash }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
      payload: {
        currentPassword: 'WrongPassword!',
        newPassword: 'BrandNewSecurePassword123!',
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/current password incorrect/);
    await app.close();
  });

  it('S2: POST /api/auth/password rejects weak new password or same password', async () => {
    const hash = await authLib.hashPassword('CorrectOldPassword123!');
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'user-1', username: 'alice', email: 'alice@example.com' }] };
      }
      if (text.includes('SELECT password_hash FROM users WHERE id')) {
        return { rows: [{ password_hash: hash }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    // Weak new password
    const resWeak = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
      payload: {
        currentPassword: 'CorrectOldPassword123!',
        newPassword: 'password123',
      },
    });
    expect(resWeak.statusCode).toBe(400);

    // Same password as current
    const resSame = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
      payload: {
        currentPassword: 'CorrectOldPassword123!',
        newPassword: 'CorrectOldPassword123!',
      },
    });
    expect(resSame.statusCode).toBe(400);
    expect(resSame.json().error).toMatch(/different from current password/);
    await app.close();
  });

  it('S2: POST /api/auth/password updates hash and revokes all other sessions', async () => {
    const hash = await authLib.hashPassword('CorrectOldPassword123!');
    let passwordUpdated = false;
    let otherSessionsDeleted = false;

    mockQuery.mockImplementation(async (text: string, params: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'user-1', username: 'alice', email: 'alice@example.com' }] };
      }
      if (text.includes('SELECT password_hash FROM users WHERE id')) {
        return { rows: [{ password_hash: hash }] };
      }
      if (text.includes('UPDATE users SET password_hash')) {
        passwordUpdated = true;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('DELETE FROM sessions WHERE user_id = $1 AND id != $2')) {
        otherSessionsDeleted = true;
        return { rows: [], rowCount: 3 };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
      payload: {
        currentPassword: 'CorrectOldPassword123!',
        newPassword: 'BrandNewSecurePassword123!',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(passwordUpdated).toBe(true);
    expect(otherSessionsDeleted).toBe(true);
    await app.close();
  });

  it('S2: POST /api/auth/sessions/revoke-all terminates all sessions and clears cookie', async () => {
    let sessionsRevoked = false;
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'user-1', username: 'alice', email: 'alice@example.com' }] };
      }
      if (text.includes('DELETE FROM sessions WHERE user_id = $1')) {
        sessionsRevoked = true;
        return { rows: [], rowCount: 5 };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sessions/revoke-all',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(sessionsRevoked).toBe(true);
    await app.close();
  });

  it('SEC-024: GET /api/invites strictly scopes to invited_user_id (no email harvesting)', async () => {
    let queryExecuted = '';
    let queryParams: any[] = [];
    mockQuery.mockImplementation(async (text: string, params: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'user-victim', username: 'attacker', email: 'victim@company.com' }] };
      }
      if (text.includes('FROM invites WHERE')) {
        queryExecuted = text;
        queryParams = params;
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invites',
      cookies: { itehaas_session: '11111111-1111-1111-1111-111111111111' },
    });
    expect(res.statusCode).toBe(200);
    // Verifies query does NOT check email = $2, only invited_user_id = $1
    expect(queryExecuted).toContain('WHERE invited_user_id = $1');
    expect(queryExecuted).not.toContain('OR email = $2');
    expect(queryParams).toEqual(['user-victim']);
    await app.close();
  });
});
