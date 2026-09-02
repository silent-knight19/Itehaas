import { describe, it, expect, vi, beforeEach } from 'vitest';
import { csrfTokenForSession } from '../lib/auth';
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

describe('S12 CSRF, CORS, & Defensive Transport Headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  describe('1. SEC-004: Cookie-Tossing & CSRF Bypass Defenses', () => {
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const validToken = csrfTokenForSession(sessionId);

    it('rejects forged cookie-tossing attack where header matches cookie but not server HMAC', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const forgedToken = 'attacker-injected-token-1234567890';

      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: {
          cookie: `itehaas_session=${sessionId}; csrf_token=${forgedToken}`,
          'x-csrf-token': forgedToken,
        },
        payload: { name: 'test', visibility: 'private' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/csrf/);
      await app.close();
    });

    it('rejects state-changing request when cross-origin does not match allowlist', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: {
          cookie: `itehaas_session=${sessionId}`,
          'x-csrf-token': validToken,
          origin: 'https://evil-untrusted-site.com',
          host: 'localhost:3001',
        },
        payload: { name: 'test', visibility: 'private' },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it('allows state-changing request with valid HMAC token and matching/allowed origin', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        }
        if (text.includes('INSERT INTO repositories')) {
          return { rows: [{ id: 'r1', name: 'test', visibility: 'private' }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos',
        headers: {
          cookie: `itehaas_session=${sessionId}`,
          'x-csrf-token': validToken,
          origin: 'http://localhost:3000',
        },
        payload: { name: 'test', visibility: 'private' },
      });

      expect([201, 400]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(403);
      await app.close();
    });

    it('protects /api/auth/logout from unauthorized cross-origin trigger', async () => {
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === sessionId) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        }
        return { rows: [], rowCount: 0 };
      });

      const app = await buildApp();
      // Attempting logout from untrusted cross-origin without valid CSRF token
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          cookie: `itehaas_session=${sessionId}`,
          origin: 'https://attacker.com',
          host: 'localhost:3001',
        },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe('2. SEC-003: CORS Configuration & Origin Validation', () => {
    it('allows configured dev origins and sets Access-Control-Allow-Origin', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/me',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-max-age']).toBe('86400');
      await app.close();
    });

    it('rejects untrusted third-party origins in CORS preflight', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/me',
        headers: {
          origin: 'https://evil-site.com',
          'access-control-request-method': 'GET',
        },
      });

      // Should not reflect evil-site.com
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    });

    it('explicitly rejects null origin', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/me',
        headers: {
          origin: 'null',
          'access-control-request-method': 'GET',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      await app.close();
    });
  });
});
