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

  describe('S14-fresh: cost-based buckets and socket-pinned identity', () => {
    const aliceSid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const authed = (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === aliceSid) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      return null;
    };

    it('fork 5/min -> 6th 429 (disk-heavy)', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const a = authed(text, params);
        if (a) return a;
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'up-1', name: 'up', description: '', visibility: 'public', default_branch: 'main', owner_id: 'u-bob', owner_name: 'bob' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-bob' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT r.id FROM repositories r WHERE r.owner_id')) return { rows: [] };
        if (text.includes('INSERT INTO repositories')) return { rows: [{ id: 'f1', name: 'up', description: '', visibility: 'public', default_branch: 'main', created_at: new Date().toISOString() }] };
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/repos/bob/up/fork',
          headers: { cookie: `itehaas_session=${aliceSid}` },
        });
        expect(res.statusCode).not.toBe(429);
      }
      const res6 = await app.inject({
        method: 'POST', url: '/api/repos/bob/up/fork',
        headers: { cookie: `itehaas_session=${aliceSid}` },
      });
      expect(res6.statusCode).toBe(429);
      await app.close();
    });

    it('object_upload 20/min -> 21st 429', async () => {
      const zlib = await import('zlib');
      const crypto = await import('crypto');
      const canonical = Buffer.from('blob 11\0hello world');
      const compressed = zlib.deflateSync(canonical);
      const hash = crypto.createHash('sha256').update(canonical).digest('hex');
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const a = authed(text, params);
        if (a) return a;
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      for (let i = 0; i < 20; i++) {
        const res = await app.inject({
          method: 'POST', url: `/api/repos/alice/repo/objects/${hash}`,
          headers: { cookie: `itehaas_session=${aliceSid}`, 'content-type': 'application/octet-stream' },
          payload: compressed,
        });
        expect(res.statusCode).not.toBe(429);
      }
      const res21 = await app.inject({
        method: 'POST', url: `/api/repos/alice/repo/objects/${hash}`,
        headers: { cookie: `itehaas_session=${aliceSid}`, 'content-type': 'application/octet-stream' },
        payload: compressed,
      });
      expect(res21.statusCode).toBe(429);
      await app.close();
    });

    it('merge 10/min -> 11th 429', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const a = authed(text, params);
        if (a) return a;
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private', default_branch: 'main' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        // S15 session-pinned lock (via getClient, shared mock here).
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
        if (text.includes('SELECT source_branch, target_branch, status, is_draft, title, body FROM pull_requests')) {
          return { rows: [{ source_branch: 'feature', target_branch: 'main', status: 'open', is_draft: false, title: 't', body: '' }] };
        }
        if (text.includes('SELECT decision FROM pr_reviews')) return { rows: [] };
        if (text.includes('SELECT name FROM ci_status_checks')) return { rows: [] };
        return { rows: [], rowCount: 1 };
      });
      mockExec.mockImplementation(async (args: string[]) => {
        if (args[0] === 'branch') return { stdout: 'main\nfeature\n', stderr: '', code: 0 };
        if (args[0] === 'checkout') return { stdout: '', stderr: '', code: 0 };
        if (args[0] === 'merge') return { stdout: 'Already up to date', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      const app = await buildApp();
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/repos/alice/repo/pulls/pr-1/merge',
          headers: { cookie: `itehaas_session=${aliceSid}` },
        });
        expect(res.statusCode).not.toBe(429);
      }
      const res11 = await app.inject({
        method: 'POST', url: '/api/repos/alice/repo/pulls/pr-1/merge',
        headers: { cookie: `itehaas_session=${aliceSid}` },
      });
      expect(res11.statusCode).toBe(429);
      await app.close();
    });

    it('socket-pinned identity: rotating XFF on a direct connection shares one bucket', async () => {
      mockQuery.mockImplementation(async (text: string) => {
        if (text.includes('FROM users WHERE username')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      // Direct connection (untrusted socket): XFF is ignored, socket IP buckets.
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/auth/login',
          remoteAddress: '203.0.113.9',
          headers: { 'x-forwarded-for': `10.99.0.${i}` },
          payload: { username: `victim${i}`, password: 'wrongwrong123' },
        });
        expect(res.statusCode).toBe(401);
      }
      const res6 = await app.inject({
        method: 'POST', url: '/api/auth/login',
        remoteAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': '10.99.0.99' },
        payload: { username: 'victimX', password: 'wrongwrong123' },
      });
      expect(res6.statusCode).toBe(429);
      await app.close();
    });

    it('org_create 10/min -> 11th 429; invites 10/min -> 11th 429', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const a = authed(text, params);
        if (a) return a;
        if (text.includes('INSERT INTO organizations')) {
          return { rows: [{ id: 'o1', name: 'org', display_name: '', description: '', created_at: new Date().toISOString() }] };
        }
        if (text.includes('SELECT id FROM organizations WHERE name=$1')) return { rows: [{ id: 'o1' }] };
        if (text.includes('SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2')) return { rows: [{ role: 'owner' }] };
        if (text.includes('INSERT INTO invites')) return { rows: [{ id: 'i1', token: 'tok', expires_at: new Date().toISOString() }] };
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/orgs',
          headers: { cookie: `itehaas_session=${aliceSid}` },
          payload: { name: `org${i}` },
        });
        expect(res.statusCode).not.toBe(429);
      }
      expect((await app.inject({
        method: 'POST', url: '/api/orgs',
        headers: { cookie: `itehaas_session=${aliceSid}` },
        payload: { name: 'org10' },
      })).statusCode).toBe(429);
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST', url: '/api/orgs/acme/invites',
          headers: { cookie: `itehaas_session=${aliceSid}` },
          payload: { username: 'alice' },
        });
        expect(res.statusCode).not.toBe(429);
      }
      expect((await app.inject({
        method: 'POST', url: '/api/orgs/acme/invites',
        headers: { cookie: `itehaas_session=${aliceSid}` },
        payload: { username: 'alice' },
      })).statusCode).toBe(429);
      await app.close();
    });

    it('ci_secrets 10/min -> 11th 429', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const a = authed(text, params);
        if (a) return a;
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'GET', url: '/api/repos/alice/repo/ci/secrets',
          headers: { cookie: `itehaas_session=${aliceSid}` },
        });
        expect(res.statusCode).not.toBe(429);
      }
      expect((await app.inject({
        method: 'GET', url: '/api/repos/alice/repo/ci/secrets',
        headers: { cookie: `itehaas_session=${aliceSid}` },
      })).statusCode).toBe(429);
      await app.close();
    });
  });
});
