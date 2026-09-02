import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

describe('S18 Observability / Incident Response', () => {
  it('S18-01 audit_logs table migration exists', async () => {
    const sql = fs.readFileSync('../database/migrations/010_audit.sql', 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
    expect(sql).toContain('user_id UUID REFERENCES users(id)');
    expect(sql).toContain('action TEXT');
    expect(sql).toContain('ip TEXT');
    expect(sql).toContain('idx_audit_logs_user');
    expect(sql).toContain('idx_audit_logs_action');
  });

  it('S18-02 audit helper exists', async () => {
    const src = fs.readFileSync('src/lib/audit.ts', 'utf8');
    expect(src).toContain('export async function auditLog');
    expect(src).toContain('INSERT INTO audit_logs');
    expect(src).toContain('incAuditLog');
  });

  it('S18-03 instrumented: DELETE /repos and auth login have auditLog', async () => {
    const repos = fs.readFileSync('src/routes/repos.ts', 'utf8');
    expect(repos).toContain("auditLog({ userId: user.id, action: 'repo.delete'");
    const auth = fs.readFileSync('src/routes/auth.ts', 'utf8');
    expect(auth).toContain("action: 'auth.login_failure'");
    expect(auth).toContain("action: 'auth.login_success'");
    const ci = fs.readFileSync('src/routes/ci.ts', 'utf8');
    expect(ci).toContain("action: 'ci.secret_create'");
  });

  it('S18-04 metrics new counters', async () => {
    const metrics = fs.readFileSync('src/lib/metrics.ts', 'utf8');
    expect(metrics).toContain('auditLogsTotal');
    expect(metrics).toContain('authFailuresTotal');
    expect(metrics).toContain('rateLimitedTotal');
    expect(metrics).toContain('itehaas_audit_logs_total');
    expect(metrics).toContain('itehaas_auth_failures_total');
    expect(metrics).toContain('itehaas_rate_limited_total');
    const index = fs.readFileSync('src/index.ts', 'utf8');
    expect(index).toContain('incAuthFailure');
    expect(index).toContain('incRateLimited');
    expect(index).toContain("warn(logData, 'auth_failure')");
  });

  it('S18-05 metrics endpoint exposes new counters', async () => {
    // Mock audit_logs table not needed — just check renderMetrics
    const { renderMetrics } = await import('../lib/metrics');
    const out = renderMetrics();
    expect(out).toContain('itehaas_audit_logs_total');
    expect(out).toContain('itehaas_auth_failures_total');
    expect(out).toContain('itehaas_rate_limited_total');
  });

  it('S18-06 incident-response host compromise flow', async () => {
    const md = fs.readFileSync('../docs/security/incident-response.md', 'utf8');
    expect(md).toContain('Host Compromise');
    expect(md).toContain('tailscale down');
    expect(md).toContain('pg_dump');
    expect(md).toContain('docker system prune');
    expect(md).toContain('DELETE FROM sessions');
    expect(md).toContain('audit_logs');
  });
});
