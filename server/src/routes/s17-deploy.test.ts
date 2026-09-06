import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('S17 Deployment / Host Hardening', () => {
  it('S17-01 PG not exposed 0.0.0.0, only 127.0.0.1', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(content).toContain('127.0.0.1:5432:5432');
    // Should not have bare "5432:5432" without 127 prefix (except maybe comments)
    const lines = content.split('\n').filter(l => l.includes('5432:5432') && !l.trim().startsWith('#'));
    for (const line of lines) {
      expect(line).toContain('127.0.0.1:5432:5432');
    }
  });

  it('S17-01 server and web also bound to 127.0.0.1', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(content).toContain('127.0.0.1:3001:3001');
    expect(content).toContain('127.0.0.1:3000:3000');
  });

  it('S17-02 config host is 127.0.0.1 in prod', async () => {
    const content = fs.readFileSync('src/config.ts', 'utf8');
    expect(content).toContain("isProd ? '127.0.0.1'");
    expect(content).toContain('host: process.env.HOST');
  });

  it('S17-03 server least privilege', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    // server section should contain user, read_only, tmpfs, security_opt, cap_drop
    expect(content).toContain('user: "65534:65534"');
    expect(content).toContain('read_only: true');
    expect(content).toContain('no-new-privileges:true');
    expect(content).toContain('cap_drop:');
    expect(content).toContain('- ALL');
    expect(content).toContain('tmpfs:');
    expect(content).toContain('/tmp:rw,noexec,nosuid');
  });

  it('S17-04 docker.sock never mounted active', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    const lines = content.split('\n');
    const activeSock = lines.filter(l => l.includes('/var/run/docker.sock') && !l.trim().startsWith('#'));
    expect(activeSock.length).toBe(0);
    expect(content).toContain('NEVER MOUNT /var/run/docker.sock');
  });

  it('S17-05 secrets fail-closed (no hardcoded defaults, mandatory env)', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    // S1-fresh: compose must require secrets via :? (no insecure fallbacks in git).
    expect(content).toContain('${POSTGRES_PASSWORD:?');
    expect(content).toContain('${COOKIE_SECRET:?');
    expect(content).toContain('${SECRET_ENCRYPTION_KEY:?');
    expect(content).toContain('${DATABASE_URL:?');
    // No hardcoded weak defaults on active (non-comment) lines.
    const active = content.split('\n').filter(l => !l.trim().startsWith('#'));
    expect(active.some(l => l.includes('POSTGRES_PASSWORD: itehaas'))).toBe(false);
    expect(active.some(l => l.includes('change-me-in-production}'))).toBe(false);
    expect(active.some(l => l.includes(':-itehaas}'))).toBe(false);
  });

  it('SEC-026: Docker host binary mount removed and multi-stage container build enabled', async () => {
    const compose = fs.readFileSync('../docker-compose.yml', 'utf8');
    const lines = compose.split('\n').filter(l => !l.trim().startsWith('#'));
    const hostBinaryMount = lines.some(l => l.includes('./target/debug/itehaas'));
    expect(hostBinaryMount).toBe(false);

    const serverDocker = fs.readFileSync('../server/Dockerfile', 'utf8');
    expect(serverDocker).toContain('AS vcs-builder');
    expect(serverDocker).toContain('USER node');

    const webDocker = fs.readFileSync('../web/Dockerfile', 'utf8');
    expect(webDocker).toContain('USER node');
  });

  it('S17-07: .dockerignore files exclude sensitive files and build caches', async () => {
    expect(fs.existsSync('../.dockerignore')).toBe(true);
    expect(fs.existsSync('../server/.dockerignore')).toBe(true);
    expect(fs.existsSync('../web/.dockerignore')).toBe(true);

    const rootIgnore = fs.readFileSync('../.dockerignore', 'utf8');
    expect(rootIgnore).toContain('.env');
    expect(rootIgnore).toContain('node_modules');
  });

  describe('S17-fresh: least-privilege runtime, safe defaults, storage perms', () => {
    it('db service is hardened (ro-root, tmpfs, caps, bounds, rotation)', async () => {
      const content = fs.readFileSync('../docker-compose.yml', 'utf8');
      const db = content.split('  server:')[0];
      expect(db).toContain('read_only: true');
      expect(db).toContain('/run/postgresql');
      expect(db).toContain('no-new-privileges:true');
      expect(db).toContain('cap_drop:');
      expect(db).toContain('cap_add:');
      expect(db).toContain('CHOWN');
      expect(db).toContain('mem_limit: 1g');
      expect(db).toContain('restart: unless-stopped');
      expect(db).toContain('max-size: "10m"');
    });

    it('server/web carry memory bounds, restart policy, and log rotation', async () => {
      const content = fs.readFileSync('../docker-compose.yml', 'utf8');
      expect(content).toContain('mem_limit: 1g');
      expect(content).toContain('mem_limit: 512m');
      expect(content.match(/restart: unless-stopped/g)!.length).toBeGreaterThanOrEqual(3);
      expect(content.match(/max-size: "10m"/g)!.length).toBeGreaterThanOrEqual(3);
    });

    it('Dockerfiles install frozen-lockfile strictly (no silent fallback)', async () => {
      for (const f of ['../server/Dockerfile', '../web/Dockerfile']) {
        const content = fs.readFileSync(f, 'utf8');
        expect(content).toContain('pnpm install --frozen-lockfile');
        expect(content).not.toContain('|| npm install');
      }
    });

    it('compose file parses as valid YAML', async () => {
      const yaml = await import('yaml');
      const content = fs.readFileSync('../docker-compose.yml', 'utf8');
      const doc: any = yaml.parse(content);
      expect(doc.services.db).toBeDefined();
      expect(doc.services.server).toBeDefined();
      expect(doc.services.web).toBeDefined();
      expect(doc.services.db.read_only).toBe(true);
    });

    it('secureRepoParentDirs makes owner+repo dirs owner-only', async () => {
      const os = await import('os');
      const path = await import('path');
      const { secureRepoParentDirs } = await import('./repos');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itehaas-s17-'));
      const repoPath = path.join(tmp, 'repos', 'alice', 'myrepo');
      await secureRepoParentDirs(repoPath);
      if (process.platform !== 'win32') {
        const ownerMode = (fs.statSync(path.join(tmp, 'repos', 'alice')).mode & 0o777).toString(8);
        expect(ownerMode).toBe('700');
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    });

    it('repo create/fork paths harden storage dirs', async () => {
      const content = fs.readFileSync('src/routes/repos.ts', 'utf8');
      expect(content).toContain('secureRepoParentDirs(repoPath)');
      expect(content).toContain('secureRepoParentDirs(forkPath)');
    });

    it('deployment profile doc exists with runbook sections', async () => {
      const doc = fs.readFileSync('../docs/security/deployment.md', 'utf8');
      for (const section of ['Container profile', 'Database notes', 'Host hardening checklist', 'Secrets handling', 'Backups', 'Tailscale', 'First-boot drill']) {
        expect(doc).toContain(section);
      }
    });
  });
});
