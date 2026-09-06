import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockGetClient = vi.fn();

vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    query: (...args: any[]) => mockQuery(...args),
    getClient: (...args: any[]) => mockGetClient(...args),
    withTransaction: async (fn: any) => {
      const client = await mockGetClient();
      try {
        await client.query('BEGIN');
        const res = await fn(client);
        await client.query('COMMIT');
        return res;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
    pool: {
      connect: (...args: any[]) => mockGetClient(...args),
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

  it('S8-05 withTransaction commits and releases on success', async () => {
    const { withTransaction } = await import('../db/index');
    let beginCalled = false;
    let commitCalled = false;
    let releaseCalled = false;
    const client = {
      query: vi.fn(async (q: string) => {
        if (q === 'BEGIN') beginCalled = true;
        if (q === 'COMMIT') commitCalled = true;
        return { rows: [] };
      }),
      release: vi.fn(() => { releaseCalled = true; }),
    };
    mockGetClient.mockResolvedValue(client);

    const res = await withTransaction(async (c) => {
      await c.query('INSERT INTO something VALUES (1)');
      return 'success_val';
    });

    expect(res).toBe('success_val');
    expect(beginCalled).toBe(true);
    expect(commitCalled).toBe(true);
    expect(releaseCalled).toBe(true);
  });

  it('S8-05 withTransaction executes ROLLBACK and releases on failure', async () => {
    const { withTransaction } = await import('../db/index');
    let rollbackCalled = false;
    let releaseCalled = false;
    const client = {
      query: vi.fn(async (q: string) => {
        if (q === 'ROLLBACK') rollbackCalled = true;
        return { rows: [] };
      }),
      release: vi.fn(() => { releaseCalled = true; }),
    };
    mockGetClient.mockResolvedValue(client);

    await expect(withTransaction(async () => {
      throw new Error('database constraint violated');
    })).rejects.toThrow('database constraint violated');

    expect(rollbackCalled).toBe(true);
    expect(releaseCalled).toBe(true);
  });

  describe('S8-fresh: atomic multi-writes and least privilege', () => {
    it('issues create leaves no orphan row when label check 403s', async () => {
      const texts: string[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        texts.push(text);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-charlie', username: 'charlie' }] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-pub', visibility: 'public' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT id FROM labels WHERE repo_id=$1')) return { rows: [] }; // unknown label
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/pub/issues',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        payload: { title: 't', body: 'b', labels: ['brand-new-label'] },
      });
      expect(res.statusCode).toBe(403);
      expect(texts.some((t) => t.includes('INSERT INTO issues'))).toBe(false);
      await app.close();
    });

    it('issues PATCH checks permissions before any UPDATE', async () => {
      const texts: string[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        texts.push(text);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-charlie', username: 'charlie' }] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-pub', visibility: 'public' }] };
        if (text.includes('SELECT author_id, repo_id FROM issues WHERE id=$1 AND repo_id=$2')) {
          return { rows: [{ author_id: 'u-charlie', repo_id: 'r-pub' }] };
        }
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/repos/alice/pub/issues/iss-1',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        payload: { title: 'new', labels: ['x'] },
      });
      expect(res.statusCode).toBe(403);
      expect(texts.some((t) => t.includes('UPDATE issues SET'))).toBe(false);
      await app.close();
    });

    it('CI run rolls back pipeline when a job insert fails (no orphan queued run)', async () => {
      const texts: string[] = [];
      const commit = 'a'.repeat(64);
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        texts.push(text);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT count(*)::int as c FROM ci_pipelines')) return { rows: [{ c: 0 }] };
        if (text.includes('INSERT INTO ci_pipelines')) return { rows: [{ id: 'p-orphan', status: 'queued' }] };
        if (text.includes('INSERT INTO ci_jobs')) throw new Error('simulated job insert failure');
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/ci/run',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        payload: { ref: 'main', commit },
      });
      expect(res.statusCode).toBe(500);
      expect(texts).toContain('ROLLBACK');
      await app.close();
    });

    it('PR merge rolls back status when activity insert fails (atomic completion)', async () => {
      const texts: string[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        texts.push(text);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'r1', visibility: 'private', default_branch: 'main' }] };
        }
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        // S15 session-pinned lock (via getClient, shared mock here).
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
        if (text.includes('SELECT source_branch, target_branch, status, is_draft, title, body FROM pull_requests')) {
          return { rows: [{ source_branch: 'feature', target_branch: 'main', status: 'open', is_draft: false, title: 'plain merge', body: '' }] };
        }
        if (text.includes('SELECT decision FROM pr_reviews')) return { rows: [] };
        if (text.includes('UPDATE pull_requests SET status')) return { rows: [], rowCount: 1 };
        if (text.includes('INSERT INTO activity')) throw new Error('simulated activity failure');
        return { rows: [], rowCount: 0 };
      });
      const { execItehaas } = await import('../lib/vcs');
      const vcs = await import('../lib/vcs');
      const spy = vi.spyOn(vcs, 'execItehaas').mockImplementation(async (args: string[]) => {
        if (args[0] === 'branch') return { stdout: 'main\nfeature\n', stderr: '', code: 0 };
        if (args[0] === 'checkout') return { stdout: '', stderr: '', code: 0 };
        if (args[0] === 'merge') return { stdout: 'Merge made', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      void execItehaas;
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/pulls/pr-1/merge',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      });
      expect(res.statusCode).toBe(500);
      expect(texts).toContain('ROLLBACK');
      expect(texts.some((t) => t.includes('UPDATE pull_requests SET status'))).toBe(true);
      spy.mockRestore();
      await app.close();
    });

    it('011_db_roles defines least privilege (DML only, NOLOGIN, guarded)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const candidates = [
        path.join(process.cwd(), 'database/migrations/011_db_roles.sql'),
        path.join(process.cwd(), '../database/migrations/011_db_roles.sql'),
      ];
      const found = candidates.find((c) => fs.existsSync(c));
      expect(found).toBeDefined();
      const sql = fs.readFileSync(found!, 'utf8');
      expect(sql).toContain('CREATE ROLE itehaas_app WITH NOLOGIN');
      expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
      expect(sql).not.toMatch(/GRANT ALL/i);
      // No baked-in credential: PASSWORD may appear in prose, never as 'literal'.
      expect(sql).not.toMatch(/PASSWORD\s*'/);
      expect(sql).toContain('insufficient_privilege');
      expect(sql).toContain('ALTER DEFAULT PRIVILEGES');
    });

    it('runtime pool prefers DATABASE_APP_URL when set', async () => {
      const prev = process.env.DATABASE_APP_URL;
      try {
        delete process.env.DATABASE_APP_URL;
        const db1: any = await import('../db/index');
        expect(db1.isLeastPrivilegeDb()).toBe(false);
        process.env.DATABASE_APP_URL = 'postgres://itehaas_app:strong-pwd-here-1234567890@db:5432/itehaas';
        // Re-evaluate via fresh import to avoid module cache staleness
        vi.resetModules();
        const db2: any = await import('../db/index');
        expect(db2.isLeastPrivilegeDb()).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.DATABASE_APP_URL;
        else process.env.DATABASE_APP_URL = prev;
        vi.resetModules();
      }
    });
  });
});
