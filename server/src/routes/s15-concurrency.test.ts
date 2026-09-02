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

  describe('Atomic Invite Acceptance & Anti-Replay', () => {
    it('atomically executes invite acceptance inside transaction with FOR UPDATE', async () => {
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
});
