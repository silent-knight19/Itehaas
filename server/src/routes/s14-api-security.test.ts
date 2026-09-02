import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

const mockQuery = vi.fn();

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

describe('S14 API Security, Rate Limiting, & Abuse Controls', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const alice = { id: 'u-alice', username: 'alice' };

  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
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

  describe('1. Pagination Bounds & Clamping', () => {
    it('clamps excessive limit=999999 to max 100 on issues list', async () => {
      let capturedLimit: any = null;
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'repo-alice', visibility: 'public' }] };
        }
        if (text.includes('FROM issues i')) {
          // params contains [repo_id, limit, offset]
          capturedLimit = params?.[1];
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/alice/repo/issues?limit=999999',
      });

      expect(res.statusCode).toBe(200);
      expect(capturedLimit).toBe(100);
      await app.close();
    });

    it('normalizes negative limit=-1 and offset=-1 to safe non-negative bounds', async () => {
      let capturedLimit: any = null;
      let capturedOffset: any = null;
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM repositories r JOIN users u')) {
          return { rows: [{ id: 'repo-alice', visibility: 'public' }] };
        }
        if (text.includes('FROM issues i')) {
          capturedLimit = params?.[1];
          capturedOffset = params?.[2];
          return { rows: [] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/alice/repo/issues?limit=-1&offset=-1',
      });

      expect(res.statusCode).toBe(200);
      expect(capturedLimit).toBe(1);
      expect(capturedOffset).toBe(0);
      await app.close();
    });

    it('rejects massive offset (> 50000) to prevent deep SQL offset denial of service', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/repos/alice/repo/issues?offset=999999',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/offset too large/);
      await app.close();
    });
  });

  describe('2. Mass Assignment Defense', () => {
    it('user profile PATCH strictly updates only bio and avatar_url, ignoring role or is_admin fields', async () => {
      let updateSql = '';
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM users WHERE username')) {
          return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
        }
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [alice] };
        }
        if (text.includes('UPDATE users SET')) {
          updateSql = text;
          return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: 'Legit bio', avatar_url: null, created_at: new Date().toISOString() }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/users/alice',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: {
          bio: 'Legit bio',
          is_admin: true,
          role: 'superuser',
          created_at: '1970-01-01',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(updateSql).toContain('bio = $1');
      expect(updateSql).not.toContain('is_admin');
      expect(updateSql).not.toContain('role');
      expect(updateSql).not.toContain('superuser');
      await app.close();
    });
  });

  describe('3. Rate Limiting Enforcement', () => {
    it('triggers 429 Too Many Requests when rate limit threshold is exceeded', async () => {
      const app = await buildApp();
      // Contributions route allows 20/min per IP
      let lastStatus = 200;
      for (let i = 0; i < 22; i++) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/users/alice/contributions',
        });
        lastStatus = res.statusCode;
        if (lastStatus === 429) {
          expect(res.headers['retry-after']).toBeDefined();
          break;
        }
      }

      expect(lastStatus).toBe(429);
      await app.close();
    });
  });
});
