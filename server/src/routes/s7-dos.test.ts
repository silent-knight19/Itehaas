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

import { buildApp } from '../index';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

describe('S7 Resource Exhaustion / DoS', () => {
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

  it('S7-03 search q too long (>100) → 400', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM repositories')) return { rows: [] };
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const longQ = 'a'.repeat(101);
    const res = await app.inject({ method: 'GET', url: `/api/search?q=${longQ}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/too long/);
    await app.close();
  });

  it('S7-03 search limit capped to 20 (50 → 20)', async () => {
    let capturedLimit = 0;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM repositories r JOIN users u')) {
        const lim = params?.[params.length - 2];
        capturedLimit = lim;
        return { rows: [] };
      }
      if (text.includes('FROM issues')) return { rows: [] };
      if (text.includes('FROM pull_requests')) return { rows: [] };
      if (text.includes('FROM users')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/search?q=hello&limit=50` });
    expect(res.statusCode).toBe(200);
    expect(capturedLimit).toBe(20);
    await app.close();
  });

  it('S7-03 search offset too large → 400', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/search?q=hello&offset=20000` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('S7-04 CI run rate-limit 5/min → 6th 429', async () => {
    let callCount = 0;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u') && text.includes('WHERE u.username=$1 AND r.name=$2')) {
        return { rows: [{ id: 'r1', visibility: 'private' }] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
      if (text.includes('SELECT tr.permission')) return { rows: [] };
      if (text.includes('SELECT count(*)::int as c FROM ci_pipelines')) return { rows: [{ c: 0 }] };
      if (text.includes('INSERT INTO ci_pipelines')) {
        callCount++;
        return { rows: [{ id: `p${callCount}`, status: 'queued' }] };
      }
      if (text.includes('INSERT INTO ci_jobs')) return { rows: [], rowCount: 1 };
      if (text.includes('SELECT id, name FROM ci_jobs')) return { rows: [] };
      if (text.includes('SELECT key, value FROM ci_secrets')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    mockExec.mockImplementation(async (args: string[]) => {
      if (args[0] === 'log') return { stdout: 'commit abc\nAuthor: a <a@b> 0 +0000\n\nmsg\n', stderr: '', code: 0 };
      return { stdout: '', stderr: '', code: 0 };
    });
    const app = await buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/ci/run',
        headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        payload: { ref: 'main' },
      });
      expect([201, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(429);
    }
    const res6 = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/ci/run',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { ref: 'main' },
    });
    expect(res6.statusCode).toBe(429);
    await app.close();
  });

  it('S7-04 CI queue bound 20 → 429 when pending >=20', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('FROM repositories r JOIN users u') && text.includes('WHERE u.username=$1 AND r.name=$2')) {
        return { rows: [{ id: 'r1', visibility: 'private' }] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('SELECT count(*)::int as c FROM ci_pipelines')) return { rows: [{ c: 20 }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/ci/run',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { ref: 'main' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/too many queued/);
    await app.close();
  });

  it('S7-01 isAncestor bounded (MAX_STEPS 2000) - code review', async () => {
    // S7 bound verified via code: MAX_STEPS 2000, visited>2000 throw, cache, semaphore 3
    // This test just verifies that the bound exists via file content
    const fs = await import('fs');
    const content = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(content).toContain('MAX_STEPS = 2000');
    expect(content).toContain('history too deep');
    expect(content).toContain('isAncestorCache');
  });

  it('S7-02 revwalk bounded (visited>10000)', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('../vcs/src/revwalk.rs', 'utf8');
    expect(content).toContain('visited.len() > 10000');
    expect(content).toContain('all_entries.len() > 10000');
  });

  it('SEC-014 linear chunk collection in octet-stream parser code check', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/routes/repos.ts', 'utf8');
    // Ensure Buffer.concat on every chunk was eliminated and replaced with chunk array push
    expect(content).toContain('chunks.push(chunk)');
    expect(content).toContain('Buffer.concat(chunks, totalLength)');
    expect(content).not.toMatch(/data\s*=\s*Buffer\.concat\(\[data,\s*chunk\]\)/);
  });
});
