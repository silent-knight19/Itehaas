import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

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

describe('S18 Observability / Incident Response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearRateLimitBuckets();
    __clearLoginFails();
    mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('S18-01 audit_logs table migration exists', async () => {
    const sql = fs.readFileSync('../database/migrations/010_audit.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
    expect(sql).toContain('user_id UUID REFERENCES users(id)');
    expect(sql).toContain('action TEXT');
    expect(sql).toContain('ip TEXT');
    expect(sql).toContain('idx_audit_logs_user');
    expect(sql).toContain('idx_audit_logs_action');
  });

  it('S18-02 audit helper exists', async () => {
    const src = fs.readFileSync('src/lib/audit.ts', 'utf8');
    expect(src).toContain('export async function auditLog');
    expect(src).toContain('INSERT INTO audit_logs');
    expect(src).toContain('incAuditLog');
  });

  it('S18-03 instrumented: DELETE /repos and auth login have auditLog', async () => {
    const repos = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(repos).toContain("auditLog({ userId: user.id, action: 'repo.delete'");
    const auth = fs.readFileSync('src/routes/auth.ts', 'utf8');
    expect(auth).toContain("action: 'auth.login_failure'");
    expect(auth).toContain("action: 'auth.login_success'");
    const ci = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(ci).toContain("action: 'ci.secret_create'");
  });

  it('S18-04 metrics new counters', async () => {
    const metrics = fs.readFileSync('src/lib/metrics.ts', 'utf8');
    expect(metrics).toContain('auditLogsTotal');
    expect(metrics).toContain('authFailuresTotal');
    expect(metrics).toContain('rateLimitedTotal');
    expect(metrics).toContain('itehaas_audit_logs_total');
    expect(metrics).toContain('itehaas_auth_failures_total');
    expect(metrics).toContain('itehaas_rate_limited_total');
    const index = fs.readFileSync('src/index.ts', 'utf8');
    expect(index).toContain('incAuthFailure');
    expect(index).toContain('incRateLimited');
    expect(index).toContain("warn(logData, 'auth_failure')");
  });

  it('S18-05 metrics endpoint exposes new counters', async () => {
    // Mock audit_logs table not needed — just check renderMetrics
    const { renderMetrics } = await import('../lib/metrics');
    const out = renderMetrics();
    expect(out).toContain('itehaas_audit_logs_total');
    expect(out).toContain('itehaas_auth_failures_total');
    expect(out).toContain('itehaas_rate_limited_total');
  });

  it('S18-06 incident-response host compromise flow', async () => {
    const md = fs.readFileSync('../docs/security/incident-response.md', 'utf8');
    expect(md).toContain('Host Compromise');
    expect(md).toContain('tailscale down');
    expect(md).toContain('pg_dump');
    expect(md).toContain('docker system prune');
    expect(md).toContain('DELETE FROM sessions');
    expect(md).toContain('audit_logs');
  });

  describe('S18-fresh: event coverage, retention, secret-free audit', () => {
    const aliceSid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const alice = { id: 'u-alice', username: 'alice' };

    function auditActions(texts: string[], params: any[][]): string[] {
      const out: string[] = [];
      texts.forEach((t, i) => {
        if (t.includes('INSERT INTO audit_logs')) out.push(String(params[i]?.[1]));
      });
      return out;
    }

    it('account lockout emits auth.lockout (stuffing signal)', async () => {
      const texts: string[] = [];
      const params: any[][] = [];
      const authLib: any = await import('../lib/auth');
      const spy = vi.spyOn(authLib, 'verifyPassword').mockResolvedValue(false);
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        texts.push(text); params.push(p ?? []);
        if (text.includes('SELECT id, username, email, password_hash')) {
          return { rows: [{ id: 'u-bob', username: 'bob', email: 'b@c', password_hash: 'h', created_at: new Date().toISOString() }] };
        }
        return { rows: [], rowCount: 0 };
      });
      const app = await buildApp();
      for (let i = 0; i < 5; i++) {
        await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'wrongwrong1' } });
      }
      __clearRateLimitBuckets();
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'wrongwrong1' } });
      expect(res.statusCode).toBe(429);
      expect(auditActions(texts, params)).toContain('auth.lockout');
      spy.mockRestore();
      await app.close();
    });

    it('repo member add/remove/role + visibility flip are audited', async () => {
      const texts: string[] = [];
      const params: any[][] = [];
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        texts.push(text); params.push(p ?? []);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (p?.[0] === aliceSid) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [{ role: 'admin' }] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT id FROM users WHERE username=$1')) return { rows: [{ id: 'u-bob' }] };
        if (text.includes('UPDATE repository_members SET')) return { rows: [{ role: 'write' }] };
        if (text.includes('UPDATE repositories SET')) {
          return { rows: [{ id: 'r1', name: 'repo', description: '', visibility: 'public', default_branch: 'main', updated_at: new Date().toISOString() }] };
        }
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      const h = { cookie: `itehaas_session=${aliceSid}` };
      expect((await app.inject({ method: 'POST', url: '/api/repos/alice/repo/members', headers: h, payload: { username: 'bob', role: 'read' } })).statusCode).toBe(201);
      expect((await app.inject({ method: 'PATCH', url: '/api/repos/alice/repo/members/bob', headers: h, payload: { role: 'write' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PATCH', url: '/api/repos/alice/repo', headers: h, payload: { visibility: 'public' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: '/api/repos/alice/repo/members/bob', headers: h })).statusCode).toBe(200);
      const actions = auditActions(texts, params);
      expect(actions).toContain('repo.member_add');
      expect(actions).toContain('repo.member_role');
      expect(actions).toContain('repo.visibility');
      expect(actions).toContain('repo.member_remove');
      await app.close();
    });

    it('org/team mutations are audited', async () => {
      const texts: string[] = [];
      const params: any[][] = [];
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        texts.push(text); params.push(p ?? []);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (p?.[0] === aliceSid) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('SELECT id FROM organizations WHERE name=$1')) return { rows: [{ id: 'o1' }] };
        if (text.includes('SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2')) return { rows: [{ role: 'owner' }] };
        if (text.includes('SELECT id FROM users WHERE username=$1')) return { rows: [{ id: 'u-bob', email: 'b@c' }] };
        if (text.includes("FROM organization_members WHERE org_id=$1 AND role='owner' FOR UPDATE")) {
          return { rows: [{ user_id: 'u-alice' }, { user_id: 'u-bob' }] };
        }
        if (text.includes('SELECT id FROM teams WHERE org_id=$1 AND name=$2')) return { rows: [{ id: 't1' }] };
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        return { rows: [{ id: 'x1' }], rowCount: 1 };
      });
      const app = await buildApp();
      const h = { cookie: `itehaas_session=${aliceSid}` };
      await app.inject({ method: 'POST', url: '/api/orgs/acme/members', headers: h, payload: { username: 'bob', role: 'member' } });
      await app.inject({ method: 'POST', url: '/api/orgs/acme/teams', headers: h, payload: { name: 'devs' } });
      await app.inject({ method: 'POST', url: '/api/orgs/acme/teams/devs/members', headers: h, payload: { username: 'bob' } });
      await app.inject({ method: 'POST', url: '/api/orgs/acme/teams/devs/repos', headers: h, payload: { owner: 'alice', repo: 'repo', permission: 'read' } });
      await app.inject({ method: 'DELETE', url: '/api/orgs/acme/teams/devs/members/bob', headers: h });
      await app.inject({ method: 'DELETE', url: '/api/orgs/acme/members/bob', headers: h });
      const actions = auditActions(texts, params);
      for (const a of ['org.member_add', 'team.create', 'team.member_add', 'team.repo_grant', 'team.member_remove', 'org.member_remove']) {
        expect(actions).toContain(a);
      }
      await app.close();
    });

    it('CI trigger + malformed object rejections are audited', async () => {
      const texts: string[] = [];
      const params: any[][] = [];
      const zlib = await import('zlib');
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        texts.push(text); params.push(p ?? []);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (p?.[0] === aliceSid) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT role FROM repository_members')) return { rows: [{ role: 'write' }] };
        if (text.includes('SELECT tr.permission')) return { rows: [] };
        if (text.includes('SELECT count(*)::int')) return { rows: [{ c: 0 }] };
        if (text.includes('INSERT INTO ci_pipelines')) return { rows: [{ id: 'p1', status: 'queued' }] };
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      const h = { cookie: `itehaas_session=${aliceSid}` };
      const run = await app.inject({ method: 'POST', url: '/api/repos/alice/repo/ci/run', headers: h, payload: { ref: 'main', commit: 'a'.repeat(64) } });
      expect(run.statusCode).toBe(201);
      const bad = zlib.deflateSync(Buffer.from('blob 999\0nope'));
      const up = await app.inject({
        method: 'POST', url: `/api/repos/alice/repo/objects/${'b'.repeat(64)}`,
        headers: { ...h, 'content-type': 'application/octet-stream' }, payload: bad,
      });
      expect(up.statusCode).toBe(400);
      // Quota walk runs on the real /tmp path (missing dir = 0 usage) — fine.
      const actions = auditActions(texts, params);
      expect(actions).toContain('ci.pipeline_trigger');
      expect(actions).toContain('vcs.object_rejected');
      await app.close();
    });

    it('audit rows never carry secret material (passwords, secret values, tokens)', async () => {
      const auditParams: any[][] = [];
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        if (text.includes('INSERT INTO audit_logs')) auditParams.push(p ?? []);
        if (text.includes('FROM sessions s JOIN users u')) {
          if (p?.[0] === aliceSid) return { rows: [alice] };
          return { rows: [] };
        }
        if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'r1', visibility: 'private' }] };
        if (text.includes('SELECT owner_id FROM repositories WHERE id = $1')) return { rows: [{ owner_id: 'u-alice' }] };
        if (text.includes('SELECT id, username, email, password_hash, created_at FROM users')) {
          const { hashPassword } = await import('../lib/auth');
          return { rows: [{ id: 'u1', username: 'carol', email: 'c@d', password_hash: await hashPassword('CorrectHorse123!'), created_at: new Date().toISOString() }] };
        }
        if (text.includes('SELECT password_hash FROM users WHERE id')) {
          const { hashPassword } = await import('../lib/auth');
          return { rows: [{ password_hash: await hashPassword('CorrectHorse123!') }] };
        }
        if (text.includes('SELECT id, value FROM ci_secrets')) {
          return { rows: [{ id: 's-1', value: 'shh-plaintext' }] };
        }
        return { rows: [], rowCount: 1 };
      });
      const app = await buildApp();
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'carol', password: 'WrongPassword99!' } });
      await app.inject({
        method: 'POST', url: '/api/repos/alice/repo/ci/secrets/rotate',
        headers: { cookie: `itehaas_session=${aliceSid}` },
      });
      const blob = auditParams.flat().filter((v) => typeof v === 'string').join('\n');
      expect(blob).not.toContain('WrongPassword99!');
      expect(blob).not.toContain('CorrectHorse123!');
      expect(blob).not.toContain('shh-plaintext');
      expect(blob).not.toContain(aliceSid);
      await app.close();
    });

    it('pruneAuditLogs issues a bounded retention DELETE (default 90d, env-tunable)', async () => {
      const { pruneAuditLogs, auditRetentionDays } = await import('../lib/audit');
      expect(auditRetentionDays({} as any)).toBe(90);
      expect(auditRetentionDays({ AUDIT_RETENTION_DAYS: '30' } as any)).toBe(30);
      expect(auditRetentionDays({ AUDIT_RETENTION_DAYS: 'junk' } as any)).toBe(90);
      const texts: string[] = [];
      const params: any[][] = [];
      mockQuery.mockImplementation(async (text: string, p?: any[]) => {
        texts.push(text); params.push(p ?? []);
        return { rows: [], rowCount: 7 };
      });
      await expect(pruneAuditLogs({ AUDIT_RETENTION_DAYS: '30' } as any)).resolves.toBe(7);
      expect(texts.some((t) => t.includes('DELETE FROM audit_logs WHERE created_at < now()'))).toBe(true);
      expect(params.some((p) => p.includes('30'))).toBe(true);
    });
  });
});
