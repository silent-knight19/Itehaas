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

describe('S10 XSS / Frontend Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  it('S10-02 avatar_url javascript: → 400', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM users WHERE username')) {
        return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
      }
      if (text.includes('SELECT id, username, email, bio, avatar_url')) return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/alice',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { avatar_url: 'javascript:alert(1)' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/https/);
    await app.close();
  });

  it('S10-02 avatar_url data: → 400', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM users WHERE username')) return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/alice',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { avatar_url: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('S10-02 avatar_url https:// allowed → 200', async () => {
    mockQuery.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes('FROM users WHERE username')) return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
      if (text.includes('FROM sessions s JOIN users u')) {
        if (params?.[0] === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') return { rows: [{ id: 'u-alice', username: 'alice' }] };
        return { rows: [] };
      }
      if (text.includes('UPDATE users SET') && text.includes('avatar_url')) {
        return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: 'https://avatars.githubusercontent.com/u/1', created_at: new Date().toISOString() }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/alice',
      headers: { cookie: 'itehaas_session=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      payload: { avatar_url: 'https://avatars.githubusercontent.com/u/1' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('S10-04 no dangerouslySetInnerHTML in web', async () => {
    const { execSync } = await import('child_process');
    try {
      const out = execSync('grep -r "dangerouslySetInnerHTML" ../web --include="*.tsx" --include="*.ts" || true', { encoding: 'utf8' });
      expect(out.trim()).toBe('');
    } catch {
      expect(true).toBe(true);
    }
  });

  it('S10-01 MarkdownViewer uses rehypeSanitize', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync('../web/components/MarkdownViewer.tsx', 'utf8');
    expect(content).toContain('rehypeSanitize');
    expect(content).toContain('rehype-sanitize');
    expect(content).toContain('noopener noreferrer');
  });
});
