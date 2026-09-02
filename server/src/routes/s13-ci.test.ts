import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('S13 CI / Container Security', () => {
  it('S13-01 sh fallback removed: executeInRunner does not use sh when docker unavailable', async () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("runner: 'unavailable'");
    expect(content).toContain('Docker unavailable, pipeline failed (no host exec)');
    // Should not contain `spawn('sh', ['-c'` for fallback
    const hasShFallback = content.includes("spawn('sh', ['-c'") && content.includes('Local execution');
    // After S13, the only sh is for docker `sh -c` inside container, not host `sh -c` with cwd repoPath
    // We check that the host fallback is removed: should not have `cwd: repoPath, env: combinedEnv` for sh
    expect(content).not.toMatch(/spawn\('sh', \['-c', script\], \{ cwd: repoPath, env: combinedEnv/);
  });

  it('S13-02 docker args hardened', async () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("'--user'");
    expect(content).toContain('65534:65534');
    expect(content).toContain("'--read-only'");
    expect(content).toContain("'--cap-drop'");
    expect(content).toContain('no-new-privileges:true');
    expect(content).toContain('--tmpfs');
    expect(content).toContain('--memory-swap');
  });

  it('S13-03 no process.env in combinedEnv', async () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).not.toContain('...process.env');
    expect(content).toContain('const combinedEnv = { ...env }');
  });

  it('S13-04 YAML limits: 64k, jobs 10, steps 20, run 5000', async () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain('64 * 1024');
    expect(content).toContain('jobKeys.length > 10');
    expect(content).toContain('steps.length > 20');
    expect(content).toContain('s.run.length > 5000');
  });

  it('S13-05 pin image alpine:3.19 not latest', async () => {
    const content = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(content).toContain("alpine:3.19");
    expect(content).not.toContain("alpine:latest");
  });

  it('S13-06 docker.sock never', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(content).toContain('NEVER MOUNT /var/run/docker.sock');
    // The active (non-commented) volumes should not contain docker.sock without comment
    const lines = content.split('\n');
    const activeSock = lines.filter(l => l.includes('/var/run/docker.sock') && !l.trim().startsWith('#'));
    expect(activeSock.length).toBe(0);
  });
});
