import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('S16 Dependency / Supply Chain', () => {
  it('S16-01 web next >=14.2.35', async () => {
    const pkg = JSON.parse(fs.readFileSync('../web/package.json', 'utf8'));
    const v = pkg.dependencies.next;
    // should be 14.2.35
    const majorMinor = v.replace('^', '').replace('~', '');
    const [major, minor, patch] = majorMinor.split('.').map(Number);
    expect(major).toBe(14);
    expect(minor).toBe(2);
    expect(patch).toBeGreaterThanOrEqual(35);
  });

  it('S16-02 tar override to 7.5.19', async () => {
    const root = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
    const overrides = root.pnpm?.overrides || {};
    expect(overrides.tar).toBe('7.5.19');
    // also lock contains 7.5.19
    const lock = fs.readFileSync('../pnpm-lock.yaml', 'utf8');
    expect(lock).toContain('tar@7.5.19');
  });

  it('S16-03 vitest >=3.2.6', async () => {
    const serverPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const webPkg = JSON.parse(fs.readFileSync('../web/package.json', 'utf8'));
    const check = (v: string) => {
      const clean = v.replace('^', '').replace('~', '');
      const parts = clean.split('.').map(Number);
      return parts[0] > 3 || (parts[0] === 3 && parts[1] > 2) || (parts[0] === 3 && parts[1] === 2 && parts[2] >= 6);
    };
    expect(check(serverPkg.devDependencies.vitest)).toBe(true);
    expect(check(webPkg.devDependencies.vitest)).toBe(true);
  });

  it('S16-04 security.yml gate exists', async () => {
    const yml = fs.readFileSync('../.github/workflows/security.yml', 'utf8');
    expect(yml).toContain('pnpm audit --prod --audit-level=critical');
    expect(yml).toContain('gitleaks');
    expect(yml).toContain('cargo audit');
  });

  it('S16-05 Dockerfile pinned to 20.18.1-alpine3.19', async () => {
    const serverDocker = fs.readFileSync('../server/Dockerfile', 'utf8');
    const webDocker = fs.readFileSync('../web/Dockerfile', 'utf8');
    expect(serverDocker).toContain('20.18.1-alpine3.19');
    expect(serverDocker).not.toContain('node:20-alpine');
    expect(webDocker).toContain('20.18.1-alpine3.19');
    expect(webDocker).not.toContain('node:20-alpine');
  });

  it('S16-06 pnpm audit --prod critical 0', async () => {
    // This test documents expectation: after S16, pnpm audit --prod --audit-level=critical should exit 0
    // We verify lock no longer has next 14.2.5 and tar 6.2.1 critical
    const lock = fs.readFileSync('../pnpm-lock.yaml', 'utf8');
    expect(lock).not.toContain('next@14.2.5');
    expect(lock).not.toContain('tar@6.2.1');
  });
});
