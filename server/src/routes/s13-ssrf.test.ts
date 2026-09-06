import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('S13 SSRF & Remote Fetch Security', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const alice = { id: 'u-alice', username: 'alice' };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_PRIVATE_REMOTES;
    delete process.env.ALLOW_LOCALHOST_REMOTE;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [alice] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        return { rows: [{ id: 'repo-alice' }] };
      }
      if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) {
        return { rows: [{ owner_id: 'u-alice' }] };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  const ssrfCases = [
    { name: 'loopback IPv4', url: 'http://127.0.0.1:3001/api/repos/a/b' },
    { name: 'localhost hostname', url: 'http://localhost:3001/api/repos/a/b' },
    { name: 'AWS/GCP/Azure link-local metadata', url: 'http://169.254.169.254/latest/meta-data' },
    { name: 'Google Cloud metadata DNS', url: 'http://metadata.google.internal/computeMetadata/v1/' },
    { name: 'Kubernetes internal cluster DNS', url: 'http://kubernetes.default.svc.cluster.local/api/repos/a/b' },
    { name: 'Internal private domain', url: 'http://backend.internal/api/repos/a/b' },
    { name: 'IPv6 loopback', url: 'http://[::1]/api/repos/a/b' },
    { name: 'IPv4-mapped IPv6 loopback', url: 'http://[::ffff:127.0.0.1]/api/repos/a/b' },
    { name: 'RFC 1918 class A (10.0.0.0/8)', url: 'http://10.0.0.1/api/repos/a/b' },
    { name: 'RFC 1918 class B (172.16.0.0/12)', url: 'http://172.20.0.1/api/repos/a/b' },
    { name: 'RFC 1918 class C (192.168.0.0/16)', url: 'http://192.168.1.1/api/repos/a/b' },
    { name: '0.0.0.0 bind-all', url: 'http://0.0.0.0:8080/api/repos/a/b' },
  ];

  for (const tc of ssrfCases) {
    it(`blocks SSRF destination: ${tc.name} (${tc.url})`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/remotes',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { name: 'upstream', url: tc.url },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/forbidden|invalid/);
      await app.close();
    });
  }

  it('allows public HTTPS remote repository destinations', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/remotes',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { name: 'origin', url: 'https://github.com/example/repo' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  describe('S13-fresh: execution-time gates (stale remotes)', () => {
    async function mockStoredRemotes(lines: string) {
      const vcs: any = await import('../lib/vcs');
      return vi.spyOn(vcs, 'execItehaas').mockImplementation(async (args: string[]) => {
        if (args[0] === 'remote') return { stdout: lines, stderr: '', code: 0 };
        return { stdout: '', stderr: '', code: 0 };
      });
    }

    it('fetch via stale file:// remote -> 403 + audit (never spawns fetch)', async () => {
      const spy = await mockStoredRemotes('victim file:///data/repos/alice/private (fetch)\n');
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/fetch',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { remote: 'victim' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/remote blocked/);
      expect(spy.mock.calls.every((c) => (c[0] as string[])[0] !== 'fetch')).toBe(true);
      spy.mockRestore();
      await app.close();
    });

    it('push via stale literal-private remote -> 403', async () => {
      const spy = await mockStoredRemotes('evil http://10.9.9.9/api/repos/x/y (fetch)\n');
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/push',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { remote: 'evil' },
      });
      expect(res.statusCode).toBe(403);
      spy.mockRestore();
      await app.close();
    });

    it('fetch of unconfigured remote -> 404 (no subprocess beyond lookup)', async () => {
      const spy = await mockStoredRemotes('origin https://example.com/api/repos/a/b (fetch)\n');
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/fetch',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { remote: 'ghost' },
      });
      expect(res.statusCode).toBe(404);
      spy.mockRestore();
      await app.close();
    });

    it('flag-like remote name in fetch body -> 400', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/fetch',
        headers: { cookie: `itehaas_session=${sessionId}` },
        payload: { remote: '--help' },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('validateRemoteUrl unit: file/creds/private blocked, public allowed', async () => {
      const { validateRemoteUrl } = await import('./repos');
      expect(validateRemoteUrl('file:///data/repos/a/b')).toMatch(/http/);
      expect(validateRemoteUrl('../../x')).toMatch(/http/);
      expect(validateRemoteUrl('https://user:pass@example.com/api/repos/a/b')).toMatch(/credentials/);
      expect(validateRemoteUrl('http://169.254.169.254/latest/meta-data')).toMatch(/private|invalid/);
      expect(validateRemoteUrl('https://example.com/api/repos/a/b')).toBeNull();
    });
  });
});
