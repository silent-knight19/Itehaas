import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockGetClient = vi.fn();

vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
  query: (...args: any[]) => mockQuery(...args),
  getClient: (...args: any[]) => mockGetClient(...args),
  pool: {
    on: vi.fn((event: string, cb: any) => {
      if (event === 'connect') {
        // Simulate connect: call cb with mock client
        // cb({ query: () => Promise.resolve() })
      }
    }),
    query: (...args: any[]) => mockQuery(...args),
  },
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

describe('S8 Database / SQL Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockGetClient.mockImplementation(async () => ({
      query: (...args: any[]) => mockQuery(...args),
      release: vi.fn(),
    }));
  });

  it('S8-01 LIMIT injection via limit param is clamped and param', async () => {
    let capturedText = '';
    let capturedParams: any[] = [];
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM repositories r JOIN users u') && text.includes('ORDER BY')) {
        capturedText = text;
        capturedParams = params || [];
        return { rows: [] };
      }
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/repos?limit=1; DROP TABLE repositories --' });
    // Should be 200 (or 400 if limit invalid), but not injection, and query should use param $1 offset $2
    expect(res.statusCode).toBe(200);
    expect(capturedText).toContain('LIMIT $');
    expect(capturedText).not.toContain('DROP');
    // qLimit should be clamped to 1 (since parseInt('1; DROP') => 1)
    expect(capturedParams[capturedParams.length - 2]).toBe(1);
    await app.close();
  });

  it('S8-01 LIMIT large value capped to 100', async () => {
    let capturedLimit = 0;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM repositories r JOIN users u') && text.includes('ORDER BY')) {
        capturedLimit = params?.[params.length - 2];
        return { rows: [] };
      }
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/repos?limit=9999' });
    expect(res.statusCode).toBe(200);
    expect(capturedLimit).toBe(100);
    await app.close();
  });

  it('S8-02 ORDER BY allowlist: invalid sort → 400', async () => {
    const app = await buildApp();
    // Mock for users repos: need to handle GET /api/users/:username/repos?sort=DROP
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM users WHERE username')) return { rows: [{ id: 'u1', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({ method: 'GET', url: '/api/users/alice/repos?sort=DROP TABLE' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('S8-02 statement_timeout is set on pool connect', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/db/index.ts', 'utf8');
    expect(content).toContain('statement_timeout');
    expect(content).toContain('connectionTimeoutMillis');
    expect(content).toContain("pool.on('connect'");
  });

  it('S8-04 transaction still BEGIN/COMMIT with orphan DELETE on exec fail', async () => {
    // This test verifies that POST /api/repos does BEGIN/COMMIT and then execItehaas, and on fail does DELETE
    // We mock getClient to track BEGIN/COMMIT and query for DELETE
    let beginCalled = false;
    let commitCalled = false;
    let deleteCalled = false;
    const mockClient: any = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN') beginCalled = true;
        if (text === 'COMMIT') commitCalled = true;
        if (text.includes('INSERT INTO repositories')) return { rows: [{ id: 'r1', name: 'test', description: '', visibility: 'private', default_branch: 'main', created_at: new Date().toISOString() }] };
        if (text.includes('INSERT INTO repository_members')) return { rows: [], rowCount: 1 };
        if (text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockGetClient.mockResolvedValue(mockClient);
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT id FROM repositories WHERE owner_id')) return { rows: [] }; // not exists
      if (text.includes('DELETE FROM repositories WHERE id = $1')) {
        deleteCalled = true;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM sessions')) return { rows: [{ id: 'u1', username: 'alice' }] };
      return { rows: [], rowCount: 0 };
    });
    // Mock execItehaas to fail
    const { execItehaas } = await import('../lib/vcs');
    const vcs = await import('../lib/vcs');
    // Need to mock execItehaas to fail for init
    vi.spyOn(vcs, 'execItehaas').mockResolvedValue({ stdout: '', stderr: 'init failed', code: 1 } as any);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { name: 'test', visibility: 'private' },
    });
    // Should be 500 due to vcs init fail, but transaction should have been committed then DELETE called
    expect([500, 400]).toContain(res.statusCode);
    expect(beginCalled).toBe(true);
    expect(commitCalled).toBe(true);
    expect(deleteCalled).toBe(true);
    vi.restoreAllMocks();
    await app.close();
  });
});
