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
      // S15: admission is serialized (FOR UPDATE) then counted inside the txn.
      if (text.includes('SELECT id FROM repositories WHERE id=$1 FOR UPDATE')) return { rows: [{ id: 'r1' }] };
      if (text.includes('FROM ci_pipelines WHERE repo_id=$1 AND status IN')) return { rows: [{ c: 20 }] };
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

  it('SEC-015: repos.ts uses async decompression (inflateAsync) instead of blocking inflateSync', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(content).toContain('inflateAsync = promisify(zlib.inflate)');
    expect(content).toContain('await inflateAsync(body');
    expect(content).not.toContain('zlib.inflateSync');
  });

  it('SEC-021: users contributions endpoint enforces rate limiting (429 on 21st request)', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM users WHERE username')) {
        return { rows: [{ id: 'u-target', username: 'targetuser', email: 'target@example.com' }] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        return { rows: [] };
      }
      if (text.includes('FROM activity')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const app = await buildApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/users/targetuser/contributions?year=2026&days=30&rnd=${i}`,
      });
      expect(res.statusCode).toBe(200);
    }

    const res21 = await app.inject({
      method: 'GET',
      url: `/api/users/targetuser/contributions?year=2026&days=30&rnd=21`,
    });
    expect(res21.statusCode).toBe(429);
    expect(res21.json().error).toMatch(/too many requests/);
    await app.close();
  });

  it('SEC-021: users.ts caps repositories scanned per request to 15', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('src/routes/users.ts', 'utf8');
    expect(content).toContain('MAX_REPOS_TO_SCAN = 15');
    expect(content).toContain('filteredRepos.slice(0, MAX_REPOS_TO_SCAN)');
  });

  describe('S7-fresh: output, collection, and disk budgets', () => {
    it('budgets: parsePagination bounds limits and offsets', async () => {
      const { parsePagination } = await import('../lib/budgets');
      expect(parsePagination({})).toEqual({ limit: 50, offset: 0 });
      expect(parsePagination({ limit: '500' })).toEqual({ limit: 100, offset: 0 });
      expect(parsePagination({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 });
      expect(parsePagination({ offset: '999999' })).toEqual({ error: 'offset too large' });
      expect(parsePagination({ limit: 'abc' })).toEqual({ error: 'invalid limit' });
    });

    it('budgets: escapeLikePattern neutralizes % and _', async () => {
      const { escapeLikePattern } = await import('../lib/budgets');
      expect(escapeLikePattern('%%')).toBe('\\%\\%');
      expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
      expect(escapeLikePattern('hello')).toBe('hello');
    });

    it('budgets: repoQuotaBytes honors env, floors absurd values', async () => {
      const { repoQuotaBytes, DEFAULT_REPO_QUOTA_BYTES } = await import('../lib/budgets');
      expect(repoQuotaBytes({} as any)).toBe(DEFAULT_REPO_QUOTA_BYTES);
      expect(repoQuotaBytes({ REPO_QUOTA_BYTES: '1073741824' } as any)).toBe(1073741824);
      expect(repoQuotaBytes({ REPO_QUOTA_BYTES: '10' } as any)).toBe(DEFAULT_REPO_QUOTA_BYTES);
      expect(repoQuotaBytes({ REPO_QUOTA_BYTES: 'junk' } as any)).toBe(DEFAULT_REPO_QUOTA_BYTES);
    });

    it('budgets: getRepoDiskUsage sums lstat sizes, skips symlinks, early-exits', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { getRepoDiskUsage } = await import('../lib/budgets');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itehaas-s7q-'));
      const itehaas = path.join(tmp, '.itehaas', 'objects', 'ab');
      fs.mkdirSync(itehaas, { recursive: true });
      fs.writeFileSync(path.join(itehaas, 'f1'), Buffer.alloc(1000, 1));
      fs.writeFileSync(path.join(itehaas, 'f2'), Buffer.alloc(2000, 2));
      expect(getRepoDiskUsage(tmp)).toBe(3000);
      // Symlink to a big outside file must not count
      const outside = path.join(tmp, 'big-outside');
      fs.writeFileSync(outside, Buffer.alloc(5000, 3));
      try { fs.symlinkSync(outside, path.join(itehaas, 'link')); } catch {}
      expect(getRepoDiskUsage(tmp)).toBe(3000);
      // Early exit once over the cap
      expect(getRepoDiskUsage(tmp, 100)).toBeGreaterThan(100);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    });

    it('S7-fresh: search escapes LIKE wildcards (q=%% stays selective)', async () => {
      let captured: any[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('SET statement_timeout')) return { rows: [], rowCount: 0 };
        if (text.includes('FROM repositories r JOIN users u')) {
          captured = params ?? [];
          return { rows: [] };
        }
        if (text.includes('FROM issues')) return { rows: [] };
        if (text.includes('FROM pull_requests')) return { rows: [] };
        if (text.includes('FROM users')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/search?q=100%25%25' });
      expect(res.statusCode).toBe(200);
      expect(captured.some((p) => typeof p === 'string' && p.includes('\\%'))).toBe(true);
      await app.close();
    });

    it('S7-fresh: forks/members/labels paginate (limit capped, offset bounded)', async () => {
      let captured: any[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'public' }] };
        if (text.includes('FROM forks f JOIN repositories')) {
          captured = params ?? [];
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/repos/alice/repo/forks?limit=5000' });
      expect(res.statusCode).toBe(200);
      expect(captured[captured.length - 2]).toBe(100);
      const bad = await app.inject({ method: 'GET', url: '/api/repos/alice/repo/forks?offset=999999' });
      expect(bad.statusCode).toBe(400);
      await app.close();
    });

    it('S7-fresh: users repos deep offset -> 400', async () => {
      mockQuery.mockImplementation(async (text: string) => {
        if (text.includes('FROM users WHERE username')) {
          return { rows: [{ id: 'u1', username: 'alice', email: 'a@b.c' }] };
        }
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/users/alice/repos?offset=999999' });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('S7-fresh: JSON body over 1MiB -> 413 (not parsed/hashed)', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'alice', password: `x`.repeat(2 * 1024 * 1024) },
      });
      expect(res.statusCode).toBe(413);
      await app.close();
    });

    it('S7-fresh: object push over repo quota -> 413', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const zlib = await import('zlib');
      const crypto = await import('crypto');
      // Plant 2MiB under the mocked repo path, set quota to 1MiB.
      const repoDir = '/tmp/itehaas_test/alice/quota-repo';
      const objDir = path.join(repoDir, '.itehaas', 'objects', 'aa');
      fs.mkdirSync(objDir, { recursive: true });
      fs.writeFileSync(path.join(objDir, 'pad'), Buffer.alloc(2 * 1024 * 1024, 7));
      const prev = process.env.REPO_QUOTA_BYTES;
      process.env.REPO_QUOTA_BYTES = String(1024 * 1024);
      try {
        mockQuery.mockImplementation(async (text: string) => {
          if (text.includes('FROM sessions s JOIN users u')) return { rows: [{ id: 'u-alice', username: 'alice' }] };
          if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
          if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
          return { rows: [], rowCount: 0 };
        });
        const canonical = Buffer.from('blob 11\0hello world');
        const compressed = zlib.deflateSync(canonical);
        const hash = crypto.createHash('sha256').update(canonical).digest('hex');
        const app = await buildApp();
        const res = await app.inject({
          method: 'POST',
          url: `/api/repos/alice/quota-repo/objects/${hash}`,
          headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'content-type': 'application/octet-stream' },
          payload: compressed,
        });
        expect(res.statusCode).toBe(413);
        expect(res.json().error).toMatch(/quota/);
        await app.close();
      } finally {
        if (prev === undefined) delete process.env.REPO_QUOTA_BYTES;
        else process.env.REPO_QUOTA_BYTES = prev;
        try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch {}
      }
    });

    it('S7-fresh: CI runner caps script and output budgets (code check)', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
      expect(content).toContain('MAX_CI_SCRIPT_BYTES');
      expect(content).toContain('MAX_CI_LOG_BYTES');
      expect(content).toContain('Logs truncated');
      expect(content).toContain('LIMIT $2');
    });
  });
});
