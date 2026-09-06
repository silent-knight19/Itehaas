import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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

describe('S10 CI/CD Runner Isolation & Host Security', () => {
  it('SEC-010: Docker runner mounts workspace as read-only (:ro)', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("'-v', `${repoPath}:/workspace:ro`");
    expect(content).not.toMatch(/'-v',\s*`\$\{repoPath\}:\/workspace`(?!\:ro)/);
  });

  it('SEC-010: Docker container isolation hardening flags are present', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("'--network', 'none'");
    expect(content).toContain("'--cap-drop', 'ALL'");
    expect(content).toContain("'--security-opt', 'no-new-privileges:true'");
    expect(content).toContain("'--user', '65534:65534'");
    expect(content).toContain("'--read-only'");
    expect(content).toContain("'--tmpfs', '/tmp:rw,noexec,nosuid,size=64m'");
    expect(content).toContain("'--pids-limit', '128'");
    expect(content).toContain("'--memory', '512m'");
  });

  it('SEC-010: Host docker socket /var/run/docker.sock is NEVER mounted', () => {
    const composeContent = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(composeContent).toContain('NEVER MOUNT /var/run/docker.sock');
    const activeSockLines = composeContent
      .split('\n')
      .filter((line) => line.includes('/var/run/docker.sock') && !line.trim().startsWith('#'));
    expect(activeSockLines.length).toBe(0);

    const ciContent = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(ciContent).not.toContain('/var/run/docker.sock');
  });

  it('SEC-008: ci.ts contains fork PR & untrusted contributor secret exclusion logic', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain('S10/SEC-008: Fork PR & untrusted contributor secret exclusion');
    expect(content).toContain('is_fork_pr');
    expect(content).toContain("role IN ('admin', 'write', 'maintainer')");
    expect(content).toContain('delete secretsEnv[k]');
  });

  it('Artifact security: collects files safely with symlink skip, traversal rejection, and 10MB ceiling', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain('stat.isSymbolicLink()');
    expect(content).toContain("size > 10 * 1024 * 1024");
    expect(content).toContain("rel.startsWith('..')");
  });

  it('S10-fresh: fd-exhaustion guard and no privileged mode', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("'--ulimit', 'nofile=1024:1024'");
    expect(content).not.toContain('--privileged');
    const compose = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(compose).not.toMatch(/^\s*privileged:\s*true/m);
  });

  it('S10-fresh: fork detection fails closed (default-untrusted, DB markers authoritative)', () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain('let isUntrusted = true');
    // A detection outage must not release secrets (old `catch {}` kept them).
    expect(content).toContain('Stay untrusted (fail closed)');
  });

  describe('S10-fresh: inline workflow budgets (FSEC-013)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      __clearRateLimitBuckets();
      __clearLoginFails();
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) {
          if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT count(*)::int as c FROM ci_pipelines')) return { rows: [{ c: 0 }] };
        if (text.includes('INSERT INTO ci_pipelines')) return { rows: [{ id: 'p1', status: 'queued' }] };
        if (text.includes('INSERT INTO ci_jobs')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
    });

    const runWithWorkflow = (workflow: any) =>
      buildApp().then((app) =>
        app.inject({
          method: 'POST',
          url: '/api/repos/alice/repo/ci/run',
          headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
          payload: { ref: 'main', commit: 'a'.repeat(64), workflow },
        }).then(async (res) => { await app.close(); return res; })
      );

    it('11 inline jobs -> 400 (queue/DB flood blocked)', async () => {
      const jobs: any = {};
      for (let i = 0; i < 11; i++) jobs[`job${i}`] = { steps: [{ run: 'echo hi' }] };
      const res = await runWithWorkflow({ jobs });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/too many jobs/);
    });

    it('21 steps in one job -> 400', async () => {
      const steps = Array.from({ length: 21 }, (_, i) => ({ run: `echo ${i}` }));
      const res = await runWithWorkflow({ jobs: { build: { steps } } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/too many steps/);
    });

    it('5001-char step -> 400', async () => {
      const res = await runWithWorkflow({ jobs: { build: { steps: [{ run: 'x'.repeat(5001) }] } } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/invalid step/);
    });

    it('valid inline workflow -> 201 with capped jobs persisted', async () => {
      const inserted: string[] = [];
      mockQuery.mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('FROM sessions s JOIN users u')) return { rows: [{ id: 'u-alice', username: 'alice' }] };
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT count(*)::int as c FROM ci_pipelines')) return { rows: [{ c: 0 }] };
        if (text.includes('INSERT INTO ci_pipelines')) return { rows: [{ id: 'p1', status: 'queued' }] };
        if (text.includes('INSERT INTO ci_jobs')) {
          inserted.push(params?.[1]);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      const res = await runWithWorkflow({ jobs: { build: { steps: [{ run: 'echo hi' }] }, test: { steps: [{ run: 'echo yo' }] } } });
      expect(res.statusCode).toBe(201);
      expect(inserted.sort()).toEqual(['build', 'test']);
    });
  });
});
