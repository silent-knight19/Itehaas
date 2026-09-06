// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

describe('S11 next.config CSP', () => {
  it('production CSP has no unsafe script and allowlists the API origin', async () => {
    vi.resetModules();
    (process.env as any).NODE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_API_URL;
    const cfg = await import('./next.config.js');
    const headers = await cfg.headers();
    const csp = headers[0]?.headers.find((h: any) => h.key === 'Content-Security-Policy')?.value as string;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    // Default API origin must be reachable or split-port prod deployments break.
    expect(csp).toContain('http://localhost:3001');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('production CSP reflects a custom API origin without wildcards', async () => {
    vi.resetModules();
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_API_URL = 'https://itehaas.tailnet.ts.net:8443/api';
    const cfg = await import('./next.config.js');
    const headers = await cfg.headers();
    const csp = headers[0]?.headers.find((h: any) => h.key === 'Content-Security-Policy')?.value as string;
    expect(csp).toContain('https://itehaas.tailnet.ts.net:8443');
    expect(csp).not.toContain('*');
    delete process.env.NEXT_PUBLIC_API_URL;
    (process.env as any).NODE_ENV = 'test';
    vi.resetModules();
  });
});
