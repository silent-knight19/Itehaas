import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * API integration tests with mocked DB + VCS.
 * Covers: health, auth register/login validation, repo creation permission, branch/log hash validation.
 */

const mockQuery = vi.fn();
const mockExec = vi.fn();

vi.mock('../db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  getClient: async () => ({
    query: (...args: any[]) => mockQuery(...args),
    release: () => {},
  }),
  pool: { on: vi.fn() },
}));

vi.mock('../lib/vcs', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    execItehaas: (...args: any[]) => mockExec(...args),
    repoPathFor: (owner: string, repo: string) => {
      if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) throw new Error('invalid owner/repo');
      return `/tmp/itehaas_test/${owner}/${repo}`;
    },
  };
});

vi.mock('../config', () => ({
  config: {
    port: 3001,
    host: '0.0.0.0',
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas',
    reposRoot: '/tmp/itehaas_test',
    itehaasBin: '/tmp/itehaas',
    cookieSecret: 'test',
    nodeEnv: 'test',
    isProd: false,
  },
}));

import { buildApp } from '../index';

describe('API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for sessions etc. - return empty for most queries unless overridden
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      // For health, no DB needed. For other queries, return empty by default
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
    mockExec.mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  });

  it('GET /health', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it('POST /api/auth/register validation 400 on bad username', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'ab', email: 'a@b.c', password: 'longenough123' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('POST /api/auth/register success 201', async () => {
    // cleanupExpiredSessions (DELETE) -> then INSERT users -> then INSERT sessions
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // cleanup
      .mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'alice', email: 'alice@example.com', created_at: new Date().toISOString() }] }) // insert user
      .mockResolvedValueOnce({ rows: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] }); // insert session
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', email: 'alice@example.com', password: 'longenough123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toBeDefined();
    await app.close();
  });

  it('GET /api/repos/:owner/:repo invalid hash 400 on tree', async () => {
    // Need repo exists + user session + canRead
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'repo1', visibility: 'public', owner_id: 'u1' }] }); // for repo lookup?
    // Actually GET /tree does: SELECT r.id, visibility ... -> need to mock
    // Let's provide sequence for tree endpoint
    const app = await buildApp();
    // Mock for canRead: first query in tree route is SELECT r.id, visibility ... so return public repo
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM repositories r JOIN users')) return { rows: [{ id: 'repo1', visibility: 'public' }] };
      return { rows: [], rowCount: 0 };
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/repos/alice/myrepo/tree/badhash',
    });
    // Should be 400 due to invalid hash regex
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/repos/:owner/:repo/branches requires read - private without auth 404', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('FROM repositories')) return { rows: [{ id: 'repo1', visibility: 'private' }] };
      if (text.includes('repository_members')) return { rows: [] };
      if (text.includes('owner_id')) return { rows: [{ owner_id: 'owner-id' }] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/repos/alice/private-repo/branches' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('POST /api/repos requires auth 401', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos',
      payload: { name: 'myrepo', visibility: 'private' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/repos public list 200', async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('WHERE r.visibility')) return { rows: [{ id: 'r1', name: 'pub', owner: 'alice' }] };
      return { rows: [] };
    });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('repos');
    await app.close();
  });

  it('POST /api/repos/:owner/:repo/push requires write 403 without member', async () => {
    // Mock auth session + repo ownership check
    // First, need session: getSessionUser will query sessions -> need to mock that
    // Since we call POST /push with cookie, we need to simulate authenticated user but not writer
    // Provide cookie header and mock DB for session + repo
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM sessions')) return { rows: [{ id: 'user1', username: 'bob', email: 'bob@example.com' }] };
      if (text.includes('FROM repositories r JOIN users')) return { rows: [{ id: 'repo1', owner_id: 'owner-id' }] };
      if (text.includes('owner_id FROM repositories')) return { rows: [{ owner_id: 'owner-id' }] };
      if (text.includes('repository_members')) return { rows: [] }; // not a member, not owner -> canWrite false
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/alice/myrepo/push',
      headers: { cookie: `itehaas_session=${sessionId}` },
      payload: { remote: 'origin' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
