import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

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
    execItehaas: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
    repoPathFor: () => '/tmp/test',
  };
});

vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '0.0.0.0',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas',
    cookieSecret: 'test-cookie-secret-32-chars-long!',
    nodeEnv: 'test',
    isProd: false,
  },
}));

import { buildApp } from '../index';
import { hashPassword } from '../lib/auth';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

describe('Auth Fixes & Case-Insensitivity Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it('Register trims username and lowercases email, returns csrf_token and sets cookies', async () => {
    let insertedUsername = '';
    let insertedEmail = '';

    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('INSERT INTO users')) {
        insertedUsername = params?.[0];
        insertedEmail = params?.[1];
        return {
          rows: [
            {
              id: 'u-101',
              username: insertedUsername,
              email: insertedEmail,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('INSERT INTO audit_logs')) return { rows: [{ id: 'a1' }] };
      if (text.includes('INSERT INTO sessions')) return { rows: [{ id: '11111111-2222-3333-4444-555555555555' }] };
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: '  johndoe  ',
        email: '  John.Doe@Example.Com  ',
        password: 'SecurePassword123!',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(insertedUsername).toBe('johndoe');
    expect(insertedEmail).toBe('john.doe@example.com');

    const body = res.json();
    expect(body.user.username).toBe('johndoe');
    expect(body.user.email).toBe('john.doe@example.com');
    expect(body.csrf_token).toBeDefined();
    expect(typeof body.csrf_token).toBe('string');

    const cookies = res.headers['set-cookie'];
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : String(cookies);
    expect(cookieStr).toContain('itehaas_session');
    expect(cookieStr).toContain('csrf_token');

    await app.close();
  });

  it('Login succeeds with case-insensitive username and returns csrf_token', async () => {
    const password = 'CorrectPassword123!';
    const hash = await hashPassword(password);
    const sessionId = '22222222-3333-4444-5555-666666666666';

    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM users WHERE')) {
        return {
          rows: [
            {
              id: 'u-102',
              username: 'johndoe',
              email: 'johndoe@example.com',
              password_hash: hash,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('INSERT INTO sessions')) return { rows: [{ id: sessionId }] };
      if (text.includes('INSERT INTO audit_logs')) return { rows: [{ id: 'a2' }] };
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    // Test with mixed-case 'JohnDoe'
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: '  JohnDoe  ',
        password,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe('johndoe');
    expect(body.csrf_token).toBeDefined();

    const cookies = res.headers['set-cookie'];
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : String(cookies);
    expect(cookieStr).toContain('itehaas_session=' + sessionId);
    expect(cookieStr).toContain('csrf_token');

    await app.close();
  });

  it('Login succeeds with email address instead of username', async () => {
    const password = 'CorrectPassword123!';
    const hash = await hashPassword(password);
    const sessionId = '33333333-4444-5555-6666-777777777777';

    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM users WHERE')) {
        return {
          rows: [
            {
              id: 'u-103',
              username: 'johndoe',
              email: 'johndoe@example.com',
              password_hash: hash,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (text.includes('INSERT INTO sessions')) return { rows: [{ id: sessionId }] };
      if (text.includes('INSERT INTO audit_logs')) return { rows: [{ id: 'a3' }] };
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'JohnDoe@Example.Com',
        password,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe('johndoe');
    expect(body.csrf_token).toBeDefined();

    await app.close();
  });

  it('GET /api/auth/me returns user and csrf_token when authenticated', async () => {
    const sessionId = '44444444-5555-6666-7777-888888888888';

    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) {
          return {
            rows: [
              {
                id: 'u-104',
                username: 'alice',
                email: 'alice@example.com',
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
      }
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: `itehaas_session=${sessionId}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe('alice');
    expect(body.csrf_token).toBeDefined();
    expect(typeof body.csrf_token).toBe('string');

    await app.close();
  });

  it('Register rejects reserved usernames', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'admin',
        email: 'admin@example.com',
        password: 'ValidPassword123!',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/reserved/i);

    await app.close();
  });

  it('Register rejects passwords shorter than 8 characters or common weak passwords', async () => {
    const app = await buildApp();

    const shortRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'testuser',
        email: 'testuser@example.com',
        password: 'short',
      },
    });
    expect(shortRes.statusCode).toBe(400);

    const weakRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'testuser',
        email: 'testuser@example.com',
        password: 'password123',
      },
    });
    expect(weakRes.statusCode).toBe(400);
    expect(weakRes.json().error).toMatch(/common or weak/i);

    await app.close();
  });
});
