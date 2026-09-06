import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

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

vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '127.0.0.1',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas_test_bin',
    cookieSecret: 'test-secret-32chars-long-for-tests-123456',
    secretEncryptionKey: 'test-sek-32chars-long-for-tests-12345678',
    nodeEnv: 'test',
    isProd: false,
  },
}));

import { buildApp } from '../index';
import { __clearRateLimitBuckets, __clearLoginFails } from '../lib/rateLimit';

const alice = { id: 'u-alice', username: 'alice', email: 'alice@example.com' };
const aliceSid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('S5-fresh: process boundary adversarial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  });

  it('oversized single arg -> rejected before spawn, semaphore released', async () => {
    const { execItehaas } = await import('../lib/vcs');
    const { vcsSemaphore } = await import('../lib/semaphore');
    await expect(execItehaas(['cat-file', '-p', 'x'.repeat(5000)], { cwd: '/tmp/itehaas_test/a/b' })).rejects.toThrow(/too large/);
    expect(vcsSemaphore.getCount()).toBe(0);
  });

  it('oversized total args -> rejected before spawn', async () => {
    const { execItehaas } = await import('../lib/vcs');
    const { vcsSemaphore } = await import('../lib/semaphore');
    const args = Array.from({ length: 10 }, (_, i) => `arg${i}-`.padEnd(1000, 'x'));
    await expect(execItehaas(args, { cwd: '/tmp/itehaas_test/a/b' })).rejects.toThrow(/too large/);
    expect(vcsSemaphore.getCount()).toBe(0);
  });

  it('oversized piped stdin -> rejected without spawn', async () => {
    const { execItehaas } = await import('../lib/vcs');
    const { vcsSemaphore } = await import('../lib/semaphore');
    await expect(
      execItehaas(['hash-object', '-w', '--stdin'], { cwd: '/tmp/itehaas_test/a/b', input: 'y'.repeat(9000) })
    ).rejects.toThrow(/too large/);
    expect(vcsSemaphore.getCount()).toBe(0);
  });

  it('isAllowedBinPath: production prefixes pass, /tmp fails', async () => {
    const { isAllowedBinPath } = await import('../lib/vcs');
    expect(isAllowedBinPath('/usr/local/bin/itehaas')).toBe(true);
    expect(isAllowedBinPath('/usr/bin/itehaas')).toBe(true);
    expect(isAllowedBinPath('/opt/itehaas/bin/itehaas')).toBe(true);
    expect(isAllowedBinPath('/tmp/evil-itehaas')).toBe(false);
    expect(isAllowedBinPath('/home/user/itehaas')).toBe(false);
  });

  it('no shell execution: spawn argv only (regression on shell:false)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/vcs.ts'), 'utf8');
    expect(src).toContain('shell: false');
    expect(src).not.toMatch(/shell:\s*true/);
  });

  it('POST /push with traversal branch -> 400 (never reaches subprocess)', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-1' }] };
      if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (const bad of ['../evil', 'a//b', 'x@{y}']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/alice/repo/push',
        headers: { cookie: `itehaas_session=${aliceSid}` },
        payload: { remote: 'origin', branch: bad },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });

  it('DELETE /remotes/:name with flag-like value -> 400', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r-1' }] };
      if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    for (const bad of ['--help', '-v', '../x']) {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/repos/alice/repo/remotes/${encodeURIComponent(bad)}`,
        headers: { cookie: `itehaas_session=${aliceSid}` },
      });
      expect(res.statusCode).toBe(400);
    }
    await app.close();
  });
});
