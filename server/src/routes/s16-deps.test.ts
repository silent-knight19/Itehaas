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

  it('S16-02 tar override to 7.5.22 (patched past GHSA stack-overflow)', async () => {
    const root = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
    const overrides = root.pnpm?.overrides || {};
    expect(overrides.tar).toBe('7.5.22');
    // also lock contains 7.5.22 and no older tar@7 line remains
    const lock = fs.readFileSync('../pnpm-lock.yaml', 'utf8');
    expect(lock).toContain('tar@7.5.22');
    expect(lock).not.toMatch(/tar@7\.5\.(19|20):/);
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

  describe('S16-fresh: patched transitives, hygiene, automation', () => {
    it('postcss override to 8.5.18 (GHSA source-map disclosure)', async () => {
      const root = JSON.parse(fs.readFileSync('../package.json', 'utf8'));
      expect(root.pnpm?.overrides?.postcss).toBe('8.5.18');
      const lock = fs.readFileSync('../pnpm-lock.yaml', 'utf8');
      expect(lock).toContain('postcss@8.5.18');
    });

    it('uuid >=11.1.1 (buffer-bounds fix) and v4 import works', async () => {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const v = String(pkg.dependencies.uuid).replace(/^[~^>=<]*/, '');
      const [major, minor, patch] = v.split('.').map(Number);
      expect(major > 11 || (major === 11 && (minor > 1 || (minor === 1 && patch >= 1)))).toBe(true);
      const { v4 } = await import('uuid');
      expect(/^[0-9a-f-]{36}$/.test(v4())).toBe(true);
    });

    it('pino-pretty dev logger dependency is declared (was referenced but missing)', async () => {
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      expect(pkg.devDependencies['pino-pretty']).toBeDefined();
      // Resolvable at runtime (dev transport target).
      await expect(import('pino-pretty')).resolves.toBeDefined();
    });

    it('Cargo.lock has no git/URL dependencies (registry-only supply chain)', async () => {
      const lock = fs.readFileSync('../Cargo.lock', 'utf8');
      expect(lock).not.toMatch(/source = "git\+/);
    });

    it('lockfiles are committed (reproducible installs)', async () => {
      const { execSync } = await import('child_process');
      const tracked = execSync('git ls-files', { cwd: '..', encoding: 'utf8' });
      expect(tracked).toContain('pnpm-lock.yaml');
      expect(tracked).toContain('Cargo.lock');
    });

    it('no install lifecycle scripts in workspace manifests (supply-chain)', async () => {
      for (const f of ['../package.json', 'package.json', '../web/package.json']) {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        const scripts = raw.scripts || {};
        for (const k of Object.keys(scripts)) {
          expect(k).not.toMatch(/^(pre|post)(install|publish)/);
        }
      }
      // pnpm-workspace.yaml is YAML by format (no scripts section by design).
      const ws = fs.readFileSync('../pnpm-workspace.yaml', 'utf8');
      expect(ws).not.toContain('postinstall');
    });

    it('security workflow is least-privilege and lockfile-strict', async () => {
      const yml = fs.readFileSync('../.github/workflows/security.yml', 'utf8');
      expect(yml).toContain('contents: read');
      expect(yml).toContain('pnpm install --frozen-lockfile');
      expect(yml).not.toContain('--frozen-lockfile || pnpm install');
      expect(yml).toContain('cargo install cargo-audit');
    });

    it('.env files are git-ignored and untracked', async () => {
      const { execSync } = await import('child_process');
      const tracked = execSync('git ls-files', { cwd: '..', encoding: 'utf8' });
      expect(tracked).not.toMatch(/(^|\/)\.env$/m);
      const gi = fs.readFileSync('../.gitignore', 'utf8');
      expect(gi).toContain('.env');
    });
  });
});
