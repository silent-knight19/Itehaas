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

  it('S17-05 secrets comment CHANGE ME', async () => {
    const content = fs.readFileSync('../docker-compose.yml', 'utf8');
    expect(content).toContain('CHANGE ME');
  });
});
