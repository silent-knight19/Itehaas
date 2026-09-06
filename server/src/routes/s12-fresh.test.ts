import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockExec = vi.fn();

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
    execItehaas: (...args: any[]) => mockExec(...args),
    repoPathFor: (owner: string, repo: string) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) throw new Error('invalid owner/repo');
      return `/tmp/itehaas_test/${owner}/${repo}`;
    },
  };
});

// NOTE: development (not test) — the S12-fresh CSRF bypass applies to the test
// suite only, so this file proves enforcement in dev.
vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '127.0.0.1',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas',
    cookieSecret: 'test-secret-32chars-long-for-tests-123456',
    secretEncryptionKey: 'test-sek-32chars-long-for-tests-12345678',
    nodeEnv: 'development',
    isProd: false,
  },
}));

import { buildApp } from '../index';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';
import { csrfTokenForSession } from '../lib/auth';
import { getAllowedOrigins, normalizeOrigin } from '../lib/origins';

const alice = { id: 'u-alice', username: 'alice', email: 'alice@example.com' };
const aliceSid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('S12-fresh: dev enforcement, shared origins, headers', () => {
  const prevAllowed = process.env.ALLOWED_ORIGIN;

  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    delete process.env.ALLOWED_ORIGIN;
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  afterEach(() => {
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = prevAllowed;
  });

  it('origins helper: trims, strips trailing slashes, splits lists', () => {
    expect(normalizeOrigin('https://a.example.com/')).toBe('https://a.example.com');
    expect(normalizeOrigin('  http://localhost:3000  ')).toBe('http://localhost:3000');
    expect(getAllowedOrigins({ ALLOWED_ORIGIN: 'https://a.example.com/, http://b:3000/' } as any)).toEqual([
      'https://a.example.com',
      'http://b:3000',
    ]);
    expect(getAllowedOrigins({ NODE_ENV: 'development' } as any).some((o) => o.includes('localhost'))).toBe(true);
    expect(getAllowedOrigins({ NODE_ENV: 'production' } as any)).toContain('https://itehaas.tailnet.ts.net');
  });

  it('dev: cookie-authed POST without CSRF tokens -> 403 (no dev bypass)', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === aliceSid) return { rows: [alice] };
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: { cookie: `itehaas_session=${aliceSid}` },
      payload: { name: 'x', visibility: 'private' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/csrf/);
    await app.close();
  });

  it('dev: valid HMAC token passes (real clients forward the cookie)', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === aliceSid) return { rows: [alice] };
        return { rows: [] };
      }
      if (text.includes('SELECT id FROM repositories WHERE owner_id')) return { rows: [] };
      if (text.includes('INSERT INTO repositories')) {
        return { rows: [{ id: 'r1', name: 'x', description: '', visibility: 'private', default_branch: 'main', created_at: new Date().toISOString() }] };
      }
      if (text.includes('INSERT INTO repository_members')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const token = csrfTokenForSession(aliceSid);
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: { cookie: `itehaas_session=${aliceSid}; csrf_token=${token}`, 'x-csrf-token': token },
      payload: { name: 'x', visibility: 'private' },
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('ALLOWED_ORIGIN with trailing slash still matches the bare origin', async () => {
    process.env.ALLOWED_ORIGIN = 'https://a.example.com/';
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/auth/me',
      headers: { origin: 'https://a.example.com', 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://a.example.com');
    await app.close();
  });

  it('API responses carry Permissions-Policy', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['permissions-policy']).toContain('camera=()');
    await app.close();
  });
});
