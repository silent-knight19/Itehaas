import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

describe('S14 Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('S14-01 global 100/min → 101st 429', async () => {
    const app = await buildApp();
    // Mock for health which doesn't need DB
    for (let i = 0; i < 100; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    }
    const res101 = await app.inject({ method: 'GET', url: '/health' });
    expect(res101.statusCode).toBe(429);
    await app.close();
  });

  it('S14-02 search 30/min → 31st 429', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM repositories')) return { rows: [] };
      if (text.includes('FROM issues')) return { rows: [] };
      if (text.includes('FROM pull_requests')) return { rows: [] };
      if (text.includes('FROM users')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/search?q=hello' });
      expect(res.statusCode).toBe(200);
    }
    const res31 = await app.inject({ method: 'GET', url: '/api/search?q=hello' });
    expect(res31.statusCode).toBe(429);
    await app.close();
  });

  it('S14-03 repo create 10/min → 11th 429', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT id FROM repositories WHERE owner_id')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        payload: { name: `repo${i}`, visibility: 'private' },
      });
      // May be 201 or 400 or 500, but not 429 for first 10
      expect(res.statusCode).not.toBe(429);
    }
    const res11 = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { name: 'repo10', visibility: 'private' },
    });
    expect(res11.statusCode).toBe(429);
    await app.close();
  });

  it('S14-04 file 60/min → 61st 429', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM repositories r JOIN users u') && text.includes('WHERE u.username=$1 AND r.name=$2')) {
        return { rows: [{ id: 'r1', visibility: 'public', default_branch: 'main' }] };
      }
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (let i = 0; i < 60; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/repos/alice/repo/file/a.txt' });
      // Should be 404 or 400 or 200, but not 429 for first 60
      expect(res.statusCode).not.toBe(429);
    }
    const res61 = await app.inject({ method: 'GET', url: '/api/repos/alice/repo/file/a.txt' });
    expect(res61.statusCode).toBe(429);
    await app.close();
  });

  it('S14: 429 response includes Retry-After header', async () => {
    const app = await buildApp();
    for (let i = 0; i < 100; i++) {
      await app.inject({ method: 'GET', url: '/health' });
    }
    const res101 = await app.inject({ method: 'GET', url: '/health' });
    expect(res101.statusCode).toBe(429);
    expect(res101.headers['retry-after']).toBeDefined();
    expect(Number(res101.headers['retry-after'])).toBeGreaterThan(0);
    await app.close();
  });
});
