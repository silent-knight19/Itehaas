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
    repoPathFor: (owner: string, repo: string) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) throw new Error('invalid owner/repo');
      if (owner === '.' || owner === '..' || repo === '.' || repo === '..') throw new Error('invalid owner/repo');
      return `/tmp/itehaas_test/${owner}/${repo}`;
    },
  };
});

vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '127.0.0.1',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas',
    cookieSecret: 'test-secret-32chars-long-for-tests-123456',
    secretEncryptionKey: 'test-sek-32chars-long-for-tests-12345678',
    nodeEnv: 'test',
    isProd: false,
  },
}));

import { buildApp } from '../index';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

// S19-fresh: cross-boundary attack chains. Each test plays an attacker end to end
// across trust boundaries and asserts the platform fails safely (deny + no leak).

const alice = { id: 'u-alice', username: 'alice', email: 'alice@example.com' };
const bob = { id: 'u-bob', username: 'bob', email: 'bob@example.com' };
const aliceSid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const bobSid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function sessionMock(user: any, sid: string) {
  return async (text: string, params?: any[]) => {
    if (text.includes('FROM sessions s JOIN users u')) {
      if (params?.[0] === sid) return { rows: [user] };
      return { rows: [] };
    }
    return null;
  };
}

describe('S19-fresh adversarial chains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  describe('auth chains: stuffing → lockout → replay after nuke', () => {
    it('credential stuffing ends in lockout, and revoked sessions stay dead', async () => {
      const authLib: any = await import('../lib/auth');
      const spy = vi.spyOn(authLib, 'verifyPassword').mockResolvedValue(false);
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('SELECT id, username, email, password_hash')) {
          return { rows: [{ id: 'u-victim', username: 'victim', email: 'v@x', password_hash: 'h', created_at: new Date().toISOString() }] };
        }
        if (text.includes('FROM sessions s JOIN users u')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      for (let i = 0; i < 5; i++) {
        expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'victim', password: `guess${i}pw` } })).statusCode).toBe(401);
      }
      __clearRateLimitBuckets();
      // 6th: locked out even with the RIGHT password shape (enumeration-safe 429).
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'victim', password: 'guessXpw' } })).statusCode).toBe(429);
      // Stolen-session replay after revoke-all: sessions table empty → 401.
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } });
      expect(me.statusCode).toBe(401);
      spy.mockRestore();
      await app.close();
    });

    it('login fixation: planted cookie is never adopted', async () => {
      const authLib: any = await import('../lib/auth');
      const spy = vi.spyOn(authLib, 'verifyPassword').mockResolvedValue(true);
      mockQuery.mockImplementation(async (text: string) => {
        if (text.includes('SELECT id, username, email, password_hash')) {
          return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', password_hash: 'h', created_at: new Date().toISOString() }] };
        }
        if (text.includes('INSERT INTO sessions')) return { rows: [{ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login',
        headers: { cookie: 'itehaas_session=attacker-planted-session' },
        payload: { username: 'alice', password: 'correct-horse-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['set-cookie'])).toContain('ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(String(res.headers['set-cookie'])).not.toContain('attacker-planted');
      spy.mockRestore();
      await app.close();
    });
  });

  describe('authZ chains: cross-tenant takeovers all fail', () => {
    function tenantMock() {
      return async (text: string, params?: any[]) => {
        // Sessions: only return a row on an exact sid match, else fall through
        // to the next user (an empty row set must NOT shadow the other user).
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === aliceSid) return { rows: [alice] };
          if (params?.[0] === bobSid) return { rows: [bob] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) {
          if (params?.[0] === 'alice') return { rows: [{ id: 'r-alice', visibility: 'private', default_branch: 'main' }] };
          if (params?.[0] === 'bob') return { rows: [{ id: 'r-bob', visibility: 'private', default_branch: 'main' }] };
          return { rows: [] };
        }
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) {
          if (params?.[0] === 'r-alice') return { rows: [{ owner_id: 'u-alice' }] };
          if (params?.[0] === 'r-bob') return { rows: [{ owner_id: 'u-bob' }] };
          return { rows: [] };
        }
        if (text.includes('SELECT role FROM repository_members')) return { rows: [] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT id FROM organizations WHERE name=$1')) return { rows: [{ id: 'o-evil' }] };
        if (text.includes('SELECT id FROM teams WHERE org_id=$1 AND name=$2')) return { rows: [{ id: 't-evil' }] };
        if (text.includes('SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2')) {
          // Bob owns his evil org; Alice has no role there.
          if (params?.[1] === 'u-bob') return { rows: [{ role: 'owner' }] };
          return { rows: [] };
        }
        if (text.includes('SELECT author_id, repo_id FROM issues WHERE id=$1 AND repo_id=$2')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      };
    }

    it("bob cannot take alice's repo via his own org team", async () => {
      mockQuery.mockImplementation(tenantMock());
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST', url: '/api/orgs/evil-org/teams/evil-team/repos',
        headers: { cookie: `itehaas_session=${bobSid}` },
        payload: { owner: 'alice', repo: 'priv', permission: 'admin' },
      });
      expect([403, 404]).toContain(res.statusCode);
      await app.close();
    });

    it("bob cannot patch alice's issue through his own repo path (BOLA)", async () => {
      mockQuery.mockImplementation(tenantMock());
      const app = await buildApp();
      const res = await app.inject({
        method: 'PATCH', url: '/api/repos/bob/priv/issues/issue-alice-1',
        headers: { cookie: `itehaas_session=${bobSid}` },
        payload: { title: 'pwned' },
      });
      // Either not-found (scoped miss) or forbidden — never applied.
      expect([403, 404]).toContain(res.statusCode);
      await app.close();
    });

    it("bob cannot read alice's private objects/history/refs", async () => {
      mockQuery.mockImplementation(tenantMock());
      const app = await buildApp();
      const h = { cookie: `itehaas_session=${bobSid}` };
      for (const url of [
        '/api/repos/alice/priv/branches',
        '/api/repos/alice/priv/log',
        `/api/repos/alice/priv/objects/${'a'.repeat(64)}`,
        '/api/repos/alice/priv/pulls',
        '/api/repos/alice/priv/issues',
        '/api/repos/alice/priv/ci/pipelines',
      ]) {
        const res = await app.inject({ method: 'GET', url, headers: h });
        expect([403, 404]).toContain(res.statusCode);
      }
      await app.close();
    });

    it('reader cannot reach admin CI secrets; fork author cannot merge', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        const s = await tenantMock()(text, params);
        const rows = (s as any)?.rows;
        if (rows && rows.length > 0) return s;
        if (text.includes('SELECT key, created_at FROM ci_secrets')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const h = { cookie: `itehaas_session=${bobSid}` };
      // Bob has no role on alice/priv: secrets list must 403…
      const sec = await app.inject({ method: 'GET', url: '/api/repos/alice/priv/ci/secrets', headers: h });
      expect([403, 404]).toContain(sec.statusCode);
      // …and merging into it must 403/404 as well.
      const merge = await app.inject({ method: 'POST', url: '/api/repos/alice/priv/pulls/pr-1/merge', headers: h });
      expect([403, 404]).toContain(merge.statusCode);
      await app.close();
    });
  });

  describe('filesystem chains: layered traversal batteries', () => {
    it('combined encodings, separators, and control tricks all rejected', async () => {
      const { isValidFilePath, isValidBranchRef } = await import('./repos');
      const badPaths = [
        '..', '../x', 'a/../..', '%2e%2e/x', '%252e%252e/x', '/abs', '\\\\unc\\share',
        'a\\b', '.itehaas/x', 'A/.ITEHAAS/y', 'x/.Git/config', 'con/x', 'lpt1.txt',
        'trailing./x', 'trailing /x', 'a\x00b', 'a\x07b', 'a\u200eb', 'a\ufeffb',
        `${'d/'.repeat(260)}f`, `${'p'.repeat(101)}/f`,
      ];
      for (const p of badPaths) expect(isValidFilePath(p)).toBe(false);
      // NOTE: inner spaces ('a b') are legitimate in filenames — only branch
      // refs reject them (flag/parse confusion class).
      for (const b of ['../x', '..', '-x', 'a//b', 'x@{y}', '.hidden', 'a b']) {
        expect(isValidBranchRef(b)).toBe(false);
      }
      // Legitimate internationalized content still passes (file paths are Unicode;
      // branch refs stay ASCII-only by design, like owner/repo identities).
      expect(isValidFilePath('docs/日本語/über_café.md')).toBe(true);
      expect(isValidBranchRef('feature/JIRA-123_x.y-z')).toBe(true);
    });

    it('dot-segment identities never resolve to a repo path', async () => {
      const vcs: any = await import('../lib/vcs');
      for (const [o, r] of [['.', 'x'], ['..', 'x'], ['x', '.'], ['x', '..'], ['..', '..']]) {
        expect(() => vcs.repoPathFor(o, r)).toThrow();
        expect(vcs.isValidOwnerRepo(o, r)).toBe(false);
      }
    });
  });

  describe('API chains: malformed shapes fail safely', () => {
    it('invalid JSON, sessions, hashes, refs, and pagination abuse', async () => {
      mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
      const app = await buildApp();
      // Malformed JSON body → 400 (not 500).
      const bad = await app.inject({
        method: 'POST', url: '/api/auth/login',
        headers: { 'content-type': 'application/json' }, payload: '{oops',
      });
      expect(bad.statusCode).toBe(400);
      // Malformed session UUID → 401 without a DB-shaped error.
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'itehaas_session=!!!' } });
      expect(me.statusCode).toBe(401);
      // Malformed object hash → 400.
      const obj = await app.inject({ method: 'GET', url: '/api/repos/a/b/objects/zzz' });
      expect(obj.statusCode).toBe(400);
      // Pagination abuse → 400.
      const pg = await app.inject({ method: 'GET', url: '/api/search?q=hello&offset=99999999' });
      expect(pg.statusCode).toBe(400);
      // Oversized auth body → 413 before hashing.
      const big = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username: 'a', password: 'x'.repeat(2 * 1024 * 1024) },
      });
      expect(big.statusCode).toBe(413);
      await app.close();
    });

    it('file API serves JSON (never text/html execution context)', async () => {
      mockQuery.mockImplementation(async (text: string) => {
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'public', default_branch: 'main' }] };
        return { rows: [], rowCount: 0 };
      });
      const { execItehaas } = await import('../lib/vcs');
      const vcs: any = await import('../lib/vcs');
      const spy = vi.spyOn(vcs, 'execItehaas').mockImplementation(async (args: string[]) => {
        if (args[0] === 'branch') return { stdout: 'main\n', stderr: '', code: 0 };
        if (args[0] === 'cat-file') return { stdout: '<script>alert(1)</script>', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      void execItehaas;
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/repos/alice/repo/file/evil.html?ref=main' });
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-type']).not.toContain('text/html');
      spy.mockRestore();
      await app.close();
    });
  });
});
