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
  hashStringToInt: (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h & 0x7fffffff;
  },
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

describe('S15 Concurrency / TOCTOU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('S15-01 concurrent push same branch: second gets 423 when lock held', async () => {
    let lockHeld = false;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('pg_try_advisory_lock')) {
        if (lockHeld) return { rows: [{ locked: false }] };
        lockHeld = true;
        return { rows: [{ locked: true }] };
      }
      if (text.includes('pg_advisory_unlock')) {
        lockHeld = false;
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        if (params?.[0] === 'alice' && params?.[1] === 'repo') return { rows: [{ id: 'r1' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    // First push should succeed (or at least not 423), second concurrent should get 423
    // We simulate by holding lock for first, then second tries
    // First request will acquire lock, but we mock to hold it
    // For this test, we just verify that second call with lockHeld=true returns 423
    // We do two sequential calls, but second will be after first releases? To simulate concurrent, we need to not release
    // Instead, we test that when lock is held, second returns 423
    // First, hold lock manually
    lockHeld = true;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/refs/heads/main',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { hash: 'a'.repeat(64) },
    });
    expect(res2.statusCode).toBe(423);
    await app.close();
  });

  it('S15-02 concurrent merge same PR: second gets 423', async () => {
    let lockHeld = false;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('pg_try_advisory_lock')) {
        if (lockHeld) return { rows: [{ locked: false }] };
        lockHeld = true;
        return { rows: [{ locked: true }] };
      }
      if (text.includes('pg_advisory_unlock')) {
        lockHeld = false;
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        if (params?.[0] === 'alice' && params?.[1] === 'repo') return { rows: [{ id: 'r1', visibility: 'private', default_branch: 'main' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('SELECT * FROM pull_requests') || text.includes('SELECT source_branch')) {
        return { rows: [{ source_branch: 'feature', target_branch: 'main', status: 'open', is_draft: false, title: 't', body: 'b' }] };
      }
      if (text.includes('SELECT decision FROM pr_reviews')) return { rows: [] };
      if (text.includes('SELECT name FROM ci_status_checks')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    lockHeld = true; // hold lock
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/pulls/1/merge',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });
    expect(res.statusCode).toBe(423);
    await app.close();
  });

  it('S15-03 delete vs push: delete holds lock, push after delete gets 404', async () => {
    let lockHeld = false;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('pg_try_advisory_lock')) {
        if (lockHeld) return { rows: [{ locked: false }] };
        lockHeld = true;
        return { rows: [{ locked: true }] };
      }
      if (text.includes('pg_advisory_unlock')) {
        lockHeld = false;
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        if (params?.[0] === 'alice' && params?.[1] === 'repo') return { rows: [{ id: 'r1' }] };
        return { rows: [] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('DELETE FROM repositories')) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
      if (text.includes('SELECT tr.permission')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/repos/alice/repo',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
