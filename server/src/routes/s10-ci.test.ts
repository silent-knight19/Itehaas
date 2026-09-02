import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
});
