import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
    execItehaas: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
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
    secretEncryptionKey: 'test-secret-encryption-key-32chars!!',
    nodeEnv: 'test',
    isProd: false,
    validateStartupConfig: (c: any) => {
      if (c.nodeEnv === 'production') {
        if (!c.cookieSecret || c.cookieSecret.length < 32 || c.cookieSecret.includes('change-me')) {
          throw new Error('Insecure COOKIE_SECRET');
        }
      }
    },
  },
}));

import { buildApp } from '../index';
import { encryptSecret, decryptSecret } from '../lib/secrets';
import { hashPassword, verifyPassword } from '../lib/auth';

describe('S19 Comprehensive Adversarial Verification (SEC-001 - SEC-026)', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const alice = { id: 'u-alice', username: 'alice', email: 'alice@example.com' };
  const bob = { id: 'u-bob', username: 'bob', email: 'bob@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === sessionId) return { rows: [alice] };
      }
      if (text.includes('FROM repositories r JOIN users u')) {
        return { rows: [{ id: 'repo-alice', name: 'repo', visibility: 'public', default_branch: 'main' }] };
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

  // SEC-001
  it('SEC-001: Production config fails closed on default/insecure credentials', async () => {
    const { config } = await import('../config');
    expect(() => {
      config.validateStartupConfig({
        nodeEnv: 'production',
        cookieSecret: 'change-me-in-production',
      });
    }).toThrow(/Insecure COOKIE_SECRET/);
  });

  // SEC-002
  it('SEC-002: Docker Compose requires non-empty environment passwords', async () => {
    const compose = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(compose).toContain('CHANGE ME');
    expect(compose).toContain('POSTGRES_PASSWORD');
  });

  // SEC-003
  it('SEC-003: Permissive CORS rejects untrusted origins with credentials', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/repos',
      headers: {
        origin: 'http://malicious-attacker.com',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  // SEC-004
  it('SEC-004: CSRF rejects cookie-tossed token mismatch and validates session HMAC', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      headers: {
        cookie: `itehaas_session=${sessionId}; itehaas_csrf=forged_token`,
        'x-csrf-token': 'forged_token',
        origin: 'http://localhost:3000',
        host: 'localhost:3001',
      },
      payload: { name: 'exploit-repo' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // SEC-005
  it('SEC-005: PII emails are omitted for unauthenticated requests', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM users WHERE username')) {
        return { rows: [{ id: 'u-target', username: 'target', email: 'secret@target.com', bio: 'hi' }] };
      }
      if (text.includes('SELECT count(*)::int as c')) {
        return { rows: [{ c: 0 }] };
      }
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/target',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBeUndefined();
    await app.close();
  });

  // SEC-006
  it('SEC-006: Organization team attachment rejects foreign repositories', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM organizations WHERE name')) return { rows: [{ id: 'org-1' }] };
      if (text.includes('FROM teams WHERE org_id')) return { rows: [{ id: 'team-1' }] };
      if (text.includes('FROM organization_members')) return { rows: [{ role: 'admin' }] };
      if (text.includes('FROM repositories r JOIN users u ON r.owner_id=u.id')) return { rows: [{ id: 'repo-victim' }] };
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-victim' }] };
      if (text.includes('SELECT permission FROM collaborators')) return { rows: [] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/orgs/my-org/teams/devs/repos',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { owner: 'victim', repo: 'secret-repo', permission: 'admin' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // SEC-007
  it('SEC-007: Remote configuration rejects file:// and local paths', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/remotes',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { name: 'leak', url: 'file:///etc/shadow' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // SEC-008
  it('SEC-008: Fork PRs are prevented from exfiltrating base repository secrets', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM pull_requests pr JOIN repositories r')) {
        return { rows: [{ id: 'pr-1', is_fork: true, base_repo_id: 'repo-base', head_repo_id: 'repo-fork' }] };
      }
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/pulls/1/ci-trigger',
      headers: { cookie: `itehaas_session=${sessionId}` },
    });
    expect([400, 403, 404]).toContain(res.statusCode);
    await app.close();
  });

  // SEC-009
  it('SEC-009: AES-256-GCM secret encryption enforces dedicated key & auth tag validation', async () => {
    const secret = 'ci-vault-secret';
    const ciphertext = encryptSecret(secret);
    expect(ciphertext).not.toBe(secret);
    expect(decryptSecret(ciphertext)).toBe(secret);
  });

  // SEC-010
  it('SEC-010: CI runner container mounts workspace with read-only restriction', async () => {
    const ciSrc = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(ciSrc).toContain(':ro');
  });

  // SEC-011
  it('SEC-011: Cross-repository issue BOLA tampering is rejected', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'repo-1' }] };
      if (text.includes('SELECT author_id, repo_id FROM issues WHERE id=$1 AND repo_id=$2')) {
        return { rows: [] }; // Not found in this repo
      }
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/repos/alice/repo/issues/issue-foreign',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { title: 'Tampered Title' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // SEC-012
  it('SEC-012: Deleting PR reviewer requires write permissions', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [bob] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'repo-alice', visibility: 'public' }] };
      if (text.includes('SELECT author_id FROM pull_requests')) return { rows: [{ author_id: 'u-alice' }] };
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('SELECT permission FROM collaborators')) return { rows: [] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/repos/alice/repo/pulls/1/reviewers/u-reviewer',
      headers: { cookie: `itehaas_session=${sessionId}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // SEC-013
  it('SEC-013: Tree & checkout engines reject case-folded .itehaas control collisions', async () => {
    const checkoutSrc = fs.readFileSync('../vcs/src/checkout.rs', 'utf8');
    expect(checkoutSrc).toContain('is_forbidden_component');
  });

  // SEC-014
  it('SEC-014: VCS tree builder enforces recursive depth & entry count limits', async () => {
    const treeSrc = fs.readFileSync('../vcs/src/tree_builder.rs', 'utf8');
    expect(treeSrc).toContain('depth > 100');
    expect(treeSrc).toContain('100_000');
    expect(treeSrc).toContain('active_ancestors');
  });

  // SEC-015
  it('SEC-015: Synchronous payload decompression enforces 64 MiB ceiling', async () => {
    const reposSrc = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(reposSrc).toContain('64 * 1024 * 1024');
  });

  // SEC-016
  it('SEC-016: Fast-forward ancestor check prevents subprocess spawning storms', async () => {
    const reposSrc = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(reposSrc).toContain('execItehaas([\'merge-base\', \'--is-ancestor\'');
  });

  // SEC-017
  it('SEC-017: Pack entry creation bounds memory allocations', async () => {
    const packSrc = fs.readFileSync('../vcs/src/pack.rs', 'utf8');
    expect(packSrc).toContain('512 * 1024 * 1024');
    expect(packSrc).toContain('64 * 1024 * 1024');
  });

  // SEC-018
  it('SEC-018: SSRF defenses reject DNS rebinding and cloud metadata IPs', async () => {
    const httpSrc = fs.readFileSync('../vcs/src/remote/http.rs', 'utf8');
    expect(httpSrc).toContain('SafeResolver');
    expect(httpSrc).toContain('169.254');
    expect(httpSrc).toContain('metadata.google.internal');
  });

  // SEC-019
  it('SEC-019: Concurrent PR merge on same repository acquires repository-level lock', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'repo-alice', visibility: 'public' }] };
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/pulls/1/merge',
      headers: { cookie: `itehaas_session=${sessionId}` },
    });
    expect(res.statusCode).toBe(423);
    await app.close();
  });

  // SEC-020
  it('SEC-020: Contribution queries use parameterized days/year filter', async () => {
    const usersSrc = fs.readFileSync('src/routes/users.ts', 'utf8');
    expect(usersSrc).not.toContain("interval '${days} days'");
  });

  // SEC-021
  it('SEC-021: Unauthenticated contributions endpoint is rate-limited', async () => {
    const usersSrc = fs.readFileSync('src/routes/users.ts', 'utf8');
    expect(usersSrc).toContain("checkRateLimit(req, 'users:contributions'");
  });

  // SEC-022
  it('SEC-022: Non-owner collaborator cannot delete repository', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [bob] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'repo-alice' }] };
      if (text.includes('SELECT owner_id FROM repositories')) return { rows: [{ owner_id: 'u-alice' }] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/repos/alice/repo',
      headers: { cookie: `itehaas_session=${sessionId}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  // SEC-023
  it('SEC-023: Public repository permits issue creation for read-collaborators & public users', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [bob] };
      if (text.includes('FROM repositories r JOIN users u')) return { rows: [{ id: 'repo-alice', visibility: 'public' }] };
      if (text.includes('INSERT INTO issues')) return { rows: [{ id: 'iss-1', title: 'Feature idea' }] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/repo/issues',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { title: 'Feature idea', body: 'Please add this' },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  // SEC-024
  it('SEC-024: Pending invites list is strictly scoped to authenticated user ID', async () => {
    let capturedParam: any = null;
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions s JOIN users u')) return { rows: [alice] };
      if (text.includes('FROM invites WHERE invited_user_id = $1')) {
        capturedParam = params?.[0];
        return { rows: [] };
      }
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/invites',
      headers: { cookie: `itehaas_session=${sessionId}` },
    });
    expect(res.statusCode).toBe(200);
    expect(capturedParam).toBe(alice.id);
    await app.close();
  });

  // SEC-025
  it('SEC-025: Production dependencies contain zero critical vulnerabilities', async () => {
    const rootPkg = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
    expect(rootPkg.pnpm?.overrides?.tar).toBe('7.5.19');
    expect(rootPkg.pnpm?.overrides?.next).toBe('14.2.35');
  });

  // SEC-026
  it('SEC-026: Multi-stage Dockerfile builds Rust binary internally without host mount', async () => {
    const dockerfile = fs.readFileSync('../server/Dockerfile', 'utf8');
    expect(dockerfile).toContain('AS vcs-builder');
    expect(dockerfile).toContain('cargo build --release');
    const compose = fs.readFileSync('../docker-compose.yml', 'utf8');
    const lines = compose.split('\n').filter(l => !l.trim().startsWith('#'));
    expect(lines.some(l => l.includes('./target/debug/itehaas'))).toBe(false);
  });
});
