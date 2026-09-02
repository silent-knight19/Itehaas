import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

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

describe('S11 XSS, Markdown Sanitization, & Content Security Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    });
  });

  describe('1. Content Security Policy & Protective Headers', () => {
    it('sends strict CSP directives and defensive framing headers on API responses', async () => {
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(200);

      // Verify CSP
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'self'");

      // Verify Anti-MIME sniffing and anti-clickjacking
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');

      await app.close();
    });
  });

  describe('2. Dangerous URI Schemes & Vector Sanitization', () => {
    const dangerousUris = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(document.cookie)',
      '   javascript:confirm(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'data:image/svg+xml;utf8,<svg onload=alert(1)>',
    ];

    for (const uri of dangerousUris) {
      it(`rejects dangerous URI scheme: ${uri.slice(0, 30)}... in user profile`, async () => {
        mockQuery.mockImplementation(async (text: string, params?: any[]) => {
          if (text.includes('FROM users WHERE username')) {
            return { rows: [{ id: 'u-alice', username: 'alice', email: 'a@b', bio: '', avatar_url: null, created_at: new Date().toISOString() }] };
          }
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
          payload: { avatar_url: uri },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/avatar_url must be https:\/\//);
        await app.close();
      });
    }
  });

  describe('3. Markdown Viewer & rehype-sanitize Configuration', () => {
    it('MarkdownViewer component does not use dangerouslySetInnerHTML anywhere', () => {
      const viewerCode = fs.readFileSync('../web/components/MarkdownViewer.tsx', 'utf8');
      expect(viewerCode).not.toContain('dangerouslySetInnerHTML');
    });

    it('MarkdownViewer configures rehype-sanitize and custom anchor protocol filter', () => {
      const viewerCode = fs.readFileSync('../web/components/MarkdownViewer.tsx', 'utf8');
      expect(viewerCode).toContain('rehypeSanitize');
      expect(viewerCode).toContain('defaultSchema');
      expect(viewerCode).toContain('javascript|data|vbscript');
      expect(viewerCode).toContain('noopener noreferrer');
    });
  });

  describe('4. Safe File Serving Architecture', () => {
    it('file serving route returns structured JSON preventing direct browser HTML execution', () => {
      const reposCode = fs.readFileSync('src/routes/repos.ts', 'utf8');
      // Verify /file/* returns structured JSON payload with content rather than raw text/html
      expect(reposCode).toContain("app.get('/api/repos/:owner/:repo/file/*'");
      expect(reposCode).toContain('return reply.send({ path: filePath, ref: branch, commit: commitHash, content, isBinary, size:');
    });
  });
});
