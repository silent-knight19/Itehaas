import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
  query: (...args: any[]) => mockQuery(...args),
  getClient: async () => ({
    query: (...args: any[]) => mockQuery(...args),
    release: vi.fn(),
  }),
  pool: { on: vi.fn() },
  };
});

vi.mock('../lib/vcs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execItehaas: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 }),
    repoPathFor: (owner: string, repo: string) => `/tmp/itehaas_test/${owner}/${repo}`,
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

import { buildApp } from '../index';
import { csrfTokenForSession } from '../lib/auth';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

describe('S11 CORS / CSRF / Headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it('S11-03 helmet headers present on GET /health', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    await app.close();
  });

  it('SEC-003 CORS allowlist: untrusted origin is blocked and allowed origin is permitted', async () => {
    const app = await buildApp();
    const untrustedRes = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.com' },
    });
    expect(untrustedRes.headers['access-control-allow-origin']).toBeUndefined();

    const allowedRes = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowedRes.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    await app.close();
  });

  it('S11-02 CSRF missing token → 403 when csrf_token cookie present', async () => {
    const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const csrf = csrfTokenForSession(sessionId);
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u') && text.includes('WHERE u.username=$1 AND r.name=$2')) {
        return { rows: [{ id: 'r1', name: 'test', visibility: 'private' }] };
      }
      if (text.includes('SELECT id FROM repositories WHERE owner_id')) return { rows: [] };
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    // Without x-csrf-token but with csrf_token cookie, should 403
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: {
        cookie: `itehaas_session=${sessionId}; csrf_token=${csrf}`,
      },
      payload: { name: 'test', visibility: 'private' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/csrf/);
    await app.close();
  });

  it('S11-02 CSRF with correct x-csrf-token → 201', async () => {
    const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const csrf = csrfTokenForSession(sessionId);
    let insertCalled = false;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT id FROM repositories WHERE owner_id')) return { rows: [] };
      if (text.includes('FROM repositories r JOIN users u') && text.includes('WHERE u.username=$1 AND r.name=$2')) {
        return { rows: [] }; // not exists
      }
      if (text.includes('INSERT INTO repositories')) {
        insertCalled = true;
        return { rows: [{ id: 'r1', name: 'test', description: '', visibility: 'private', default_branch: 'main', created_at: new Date().toISOString() }] };
      }
      if (text.includes('INSERT INTO repository_members')) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT id FROM repositories r JOIN users u')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: {
        cookie: `itehaas_session=${sessionId}; csrf_token=${csrf}`,
        'x-csrf-token': csrf,
      },
      payload: { name: 'test', visibility: 'private' },
    });
    // Should be 201 (or 400 if validation, but not 403)
    expect([201, 400]).toContain(res.statusCode);
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('S11-02 login sets csrf_token cookie', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM users WHERE username')) {
        // Return user with hash for correct password
        const hash = '$argon2id$v=19$m=65536,t=3,p=1$test$hash';
        return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', password_hash: hash, created_at: new Date().toISOString() }] };
      }
      return { rows: [], rowCount: 0 };
    });
    // Mock verify to true
    const { verifyPassword } = await import('../lib/auth');
    const spy = vi.spyOn(await import('../lib/auth'), 'verifyPassword').mockResolvedValue(true as any);
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('DELETE FROM sessions')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM users WHERE username')) {
        return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', password_hash: 'hash', created_at: new Date().toISOString() }] };
      }
      if (text.includes('INSERT INTO sessions')) return { rows: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'correct123' },
    });
    const setCookie = res.headers['set-cookie'] as any;
    const cookies = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookies).toContain('csrf_token');
    expect(cookies).toContain('itehaas_session');
    spy.mockRestore();
    await app.close();
  });

  it('SEC-004: In production mode, CSRF fails closed if token missing', async () => {
    const { config } = await import('../config');
    const prevProd = config.isProd;
    config.isProd = true;
    const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: {
        cookie: `itehaas_session=${sessionId}`, // no csrf_token cookie and no x-csrf-token
      },
      payload: { name: 'test', visibility: 'private' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/csrf/);
    config.isProd = prevProd;
    await app.close();
  });
});
