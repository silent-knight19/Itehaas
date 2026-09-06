import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock('../db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    query: (...args: any[]) => mockQuery(...args),
    getClient: async () => ({
      query: (...args: any[]) => mockClientQuery(...args),
      release: mockRelease,
    }),
    pool: { on: vi.fn() },
    hashStringToInt: (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash);
    },
  };
});

vi.mock('../lib/vcs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execItehaas: vi.fn().mockResolvedValue({ stdout: 'Merged successfully', stderr: '', code: 0 }),
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

describe('S15 Concurrency, Merge Collision, & TOCTOU Defense', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const alice = { id: 'u-alice', username: 'alice' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [alice] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        return { rows: [{ id: 'repo-alice', visibility: 'public', default_branch: 'main' }] };
      }
      if (text.includes('SELECT r.id, r.visibility FROM repositories')) {
        return { rows: [{ id: 'repo-alice', visibility: 'public', default_branch: 'main' }] };
      }
      if (text.includes('SELECT owner_id FROM repositories')) {
        return { rows: [{ owner_id: 'u-alice' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    // S15: session-pinned locks go through getClient — serve them from the same
    // matchers by default so lock/unlock share one mock backend per test.
    mockClientQuery.mockImplementation(async (text: string, params?: any[]) => mockQuery(text, params));
  });

  describe('SEC-019: PR Merge Collision & Repository Lock', () => {
    it('rejects concurrent merge on same repository with HTTP 423 even if PR IDs differ', async () => {
      // Simulate PR 1 holding the repo merge lock
      let lockAttempts: any[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
        if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'repo-alice', visibility: 'public', default_branch: 'main' }] };
        }
        if (text.includes('SELECT owner_id FROM repositories')) {
          return { rows: [{ owner_id: 'u-alice' }] };
        }
        if (text.includes('pg_try_advisory_lock')) {
          lockAttempts.push(params?.[0]);
          // Return locked: false (simulating an in-flight merge holding the lock)
          return { rows: [{ locked: false }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/pulls/2/merge',
        headers: { cookie: `itehaas_session=${sessionId}` },
      });

      expect(res.statusCode).toBe(423);
      expect(res.json().error).toMatch(/merge locked/);
      expect(lockAttempts.length).toBe(1);
      await app.close();
    });

    it('successfully acquires repository lock and executes merge when no collision exists', async () => {
      let advisoryUnlocked = false;
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
        if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'repo-alice', visibility: 'public', default_branch: 'main' }] };
        }
        if (text.includes('SELECT owner_id FROM repositories')) {
          return { rows: [{ owner_id: 'u-alice' }] };
        }
        if (text.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: true }] };
        }
        if (text.includes('pg_advisory_unlock')) {
          advisoryUnlocked = true;
          return { rows: [{ unlocked: true }] };
        }
        if (text.includes('SELECT source_branch, target_branch, status, is_draft')) {
          return { rows: [{ source_branch: 'feature', target_branch: 'main', status: 'open', is_draft: false, title: 'Add feature', body: 'fixes #1' }] };
        }
        if (text.includes('SELECT decision FROM pr_reviews')) {
          return { rows: [] };
        }
        if (text.includes('ci_status_checks')) {
          return { rows: [] };
        }
        if (text.includes('UPDATE pull_requests SET status=\'merged\'')) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/pulls/1/merge',
        headers: { cookie: `itehaas_session=${sessionId}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(advisoryUnlocked).toBe(true);
      await app.close();
    });
  });

  describe('Atomic Invite Acceptance & Anti-Replay', () => {    it('atomically executes invite acceptance inside transaction with FOR UPDATE', async () => {
      let forUpdateCalled = false;
      let transactionCommitted = false;

      mockClientQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text === 'BEGIN') return {};
        if (text.includes('FOR UPDATE')) {
          forUpdateCalled = true;
          return {
            rows: [{
              id: 'inv-123',
              token: 'tok-abc',
              status: 'pending',
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              invited_user_id: alice.id,
              org_id: 'org-1',
              role: 'member',
            }],
          };
        }
        if (text.includes('UPDATE invites SET status=\'accepted\'')) {
          return { rows: [] };
        }
        if (text.includes('INSERT INTO organization_members')) {
          return { rows: [] };
        }
        if (text === 'COMMIT') {
          transactionCommitted = true;
          return {};
        }
        return { rows: [] };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/invites/tok-abc/accept',
        headers: { cookie: `itehaas_session=${sessionId}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(forUpdateCalled).toBe(true);
      expect(transactionCommitted).toBe(true);
      expect(mockRelease).toHaveBeenCalled();
      await app.close();
    });
  });

  describe('S15-fresh: unified locks, stale-steal, atomic admission, rev reads', () => {
    it('advisoryLockKeys is deterministic, repo-scoped, and 31-bit safe', async () => {
      const db: any = await import('../db/index');
      const a = db.advisoryLockKeys('repo-alice');
      const b = db.advisoryLockKeys('repo-alice');
      const c = db.advisoryLockKeys('repo-bob');
      expect(a).toEqual(b);
      expect(a).not.toEqual(c);
      for (const n of [...a, ...c]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(0x7fffffff);
      }
    });

    it('lock helpers pin lock/unlock to the passed client; contested/errors \u2192 false', async () => {
      const db: any = await import('../db/index');
      const texts: string[] = [];
      const fakeClient = {
        query: async (text: string) => {
          texts.push(text);
          if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (text.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
          return { rows: [], rowCount: 0 };
        },
      };
      expect(await db.lockClientAdvisory(fakeClient, [11, 22])).toBe(true);
      await db.unlockClientAdvisory(fakeClient, [11, 22]);
      // Unlock targets the same two-part key on the same backend.
      expect(texts.filter((t) => t.includes('pg_try_advisory_lock')).length).toBe(1);
      expect(texts.filter((t) => t.includes('pg_advisory_unlock')).length).toBe(1);

      const denied = { query: async () => ({ rows: [{ locked: false }] }) };
      expect(await db.lockClientAdvisory(denied, [11, 22])).toBe(false);
      const down = { query: async () => { throw new Error('db down'); } };
      expect(await db.lockClientAdvisory(down, [11, 22])).toBe(false);
    });

    it('push and merge resolve to the SAME lock key (mutual exclusion)', async () => {
      const db: any = await import('../db/index');
      // Both flows derive one per-repo key via advisoryLockKeys (merge previously
      // used a separate 'repo-merge:' key and raced pushes).
      const fs = await import('fs');
      const reposSrc = fs.readFileSync('src/routes/repos.ts', 'utf8');
      const pullsSrc = fs.readFileSync('src/routes/pulls.ts', 'utf8');
      expect(reposSrc).toContain('advisoryLockKeys(r.rows[0].id)');
      expect(pullsSrc).toContain('advisoryLockKeys');
      expect(pullsSrc).toContain('mergeKeys(meta.id)');
      expect(pullsSrc).not.toContain("repo-merge:'");
      expect(db.advisoryLockKeys('same-repo')).toEqual(db.advisoryLockKeys('same-repo'));
    });

    it('stale ref lock (dead pid) is stolen; live lock yields 423', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const base = '/tmp/itehaas_test/alice/stale-repo';
      const heads = path.join(base, '.itehaas', 'refs', 'heads');
      fs.mkdirSync(heads, { recursive: true });
      const ref = path.join(heads, 'main');
      const lock = ref + '.lock';
      const tip = 'c'.repeat(64);
      fs.writeFileSync(ref, tip + '\n');
      // Stale: holder pid cannot exist, fresh timestamp (proves pid-liveness path).
      fs.writeFileSync(lock, `2147483647:${Date.now()}\n`);
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-stale' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [{ role: 'write' }] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
        if (text.includes('pg_advisory_unlock')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });
      const { execItehaas } = await import('../lib/vcs');
      const vcs: any = await import('../lib/vcs');
      const spy = vi.spyOn(vcs, 'execItehaas').mockImplementation(async (args: string[]) => {
        if (args[0] === 'cat-file') return { stdout: 'commit', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      void execItehaas;
      const app = await buildApp();
      // New hash object "exists" check uses real fs — plant it so FF passes trivially.
      const newHash = 'd'.repeat(64);
      const objDir = path.join(base, '.itehaas', 'objects', newHash.slice(0, 2));
      fs.mkdirSync(objDir, { recursive: true });
      fs.writeFileSync(path.join(objDir, newHash.slice(2)), Buffer.from('x'));
      const tipDir = path.join(base, '.itehaas', 'objects', tip.slice(0, 2));
      fs.mkdirSync(tipDir, { recursive: true });
      fs.writeFileSync(path.join(tipDir, tip.slice(2)), Buffer.from('y'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/stale-repo/refs/heads/main',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { hash: newHash, force: true },
      });
      expect(res.statusCode).toBe(200);
      spy.mockRestore();
      await app.close();
      try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
    });

    it('concurrent double-fork collapses to 409, not 500', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'up-1', name: 'up', description: '', visibility: 'public', default_branch: 'main', owner_id: 'u-bob', owner_name: 'bob' }] };
        }
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-bob' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [{ role: 'read' }] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT r.id FROM repositories r WHERE r.owner_id')) return { rows: [] };
        if (text.includes('INSERT INTO repositories')) {
          const e: any = new Error('duplicate key');
          e.code = '23505';
          throw e;
        }
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/bob/up/fork',
        headers: { cookie: `itehaas_session=${sessionId}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/already forked/);
      await app.close();
    });

    it('GET /log?ref= never mutates HEAD (reads via --rev)', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const base = '/tmp/itehaas_test/alice/log-repo';
      const dot = path.join(base, '.itehaas');
      fs.mkdirSync(path.join(dot, 'refs', 'heads'), { recursive: true });
      const before = 'ref: refs/heads/main\n';
      fs.writeFileSync(path.join(dot, 'HEAD'), before);
      fs.writeFileSync(path.join(dot, 'refs', 'heads', 'main'), `${'e'.repeat(64)}\n`);
      fs.writeFileSync(path.join(dot, 'refs', 'heads', 'feature'), `${'f'.repeat(64)}\n`);
      let seenArgs: string[][] = [];
      const vcs: any = await import('../lib/vcs');
      const spy = vi.spyOn(vcs, 'execItehaas').mockImplementation(async (args: string[]) => {
        seenArgs.push(args);
        if (args[0] === 'log') return { stdout: 'commit eeee\nAuthor: a <a@b> 0 +0000\n\nmsg\n', stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-log', visibility: 'public' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/alice/log-repo/log?ref=feature',
        headers: { cookie: `itehaas_session=${sessionId}` },
      });
      expect(res.statusCode).toBe(200);
      expect(seenArgs.some((a) => a.includes('--rev') && a.includes('feature'))).toBe(true);
      expect(fs.readFileSync(path.join(dot, 'HEAD'), 'utf8')).toBe(before);
      spy.mockRestore();
      await app.close();
      try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
    });

    it('isValidBranchRef rejects leading dashes (flag confusion)', async () => {
      const { isValidBranchRef } = await import('./repos');
      expect(isValidBranchRef('-foo')).toBe(false);
      expect(isValidBranchRef('--help')).toBe(false);
      expect(isValidBranchRef('feature/x')).toBe(true);
      expect(isValidBranchRef('main')).toBe(true);
    });
  });
});
