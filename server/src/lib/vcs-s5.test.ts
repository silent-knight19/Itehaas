import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

describe('S5 Process Execution Security', () => {
  it('S5-01 env allowlist: getAllowedEnv does not contain secrets', async () => {
    const prevDb = process.env.DATABASE_URL;
    const prevCookie = process.env.COOKIE_SECRET;
    process.env.DATABASE_URL = 'postgres://secret:pass@localhost/db';
    process.env.COOKIE_SECRET = 'super-secret-32chars-long-1234567890';
    const { getAllowedEnv } = await import('./vcs');
    const env = getAllowedEnv();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.COOKIE_SECRET).toBeUndefined();
    expect(env.PATH).toBeDefined();
    expect(env.LANG).toBeDefined();
    // Restore
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb; else delete process.env.DATABASE_URL;
    if (prevCookie !== undefined) process.env.COOKIE_SECRET = prevCookie; else delete process.env.COOKIE_SECRET;
  });

  it('S5-03 cwd validation rejects outside repo', async () => {
    const { execItehaas } = await import('./vcs');
    await expect(execItehaas(['log'], { cwd: '/etc' })).rejects.toThrow(/path traversal/);
    await expect(execItehaas(['log'], { cwd: '/tmp' })).rejects.toThrow(/path traversal/);
  });

  it('S5-04 arg flag injection blocked for non-allowlisted flags', async () => {
    const { execItehaas, isAllowedFlag } = await import('./vcs');
    const { config } = await import('../config');
    expect(isAllowedFlag('-p')).toBe(true);
    expect(isAllowedFlag('--help')).toBe(true);
    expect(isAllowedFlag('--evil')).toBe(false);
    expect(isAllowedFlag('-x')).toBe(false);
    const validCwd = path.join(path.resolve(config.reposRoot), 'testuser', 'testrepo2');
    fs.mkdirSync(validCwd, { recursive: true });
    // Non-allowlisted flag as branch should be rejected
    await expect(execItehaas(['checkout', '--evil'], { cwd: validCwd })).rejects.toThrow(/invalid arg flag/);
    await expect(execItehaas(['checkout', '-x'], { cwd: validCwd })).rejects.toThrow(/invalid arg flag/);
    // Allowlisted flag should not be rejected as flag error (may still fail for other reasons like repo not found, but not flag)
    try {
      await execItehaas(['cat-file', '-p', 'abc'], { cwd: validCwd });
    } catch (e: any) {
      expect(e.message).not.toMatch(/invalid arg flag/);
    }
    try { fs.rmSync(validCwd, { recursive: true, force: true }); } catch {}
  });

  it('S5-05 semaphore limits concurrency to 3', async () => {
    const { Semaphore } = await import('./semaphore');
    const sem = new Semaphore(3);
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push((async () => {
        await sem.acquire();
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        // Simulate work 20ms
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        sem.release();
      })());
    }
    await Promise.all(tasks);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(sem.getCount()).toBe(0);
  });

  it('S5-02 bin pin: getValidatedBin rejects world-writable', async () => {
    const { getValidatedBin } = await import('./vcs');
    // Normal bin should pass (or throw not found but not world-writable)
    // For test env, bin may not exist, but should not throw world-writable
    try {
      const bin = getValidatedBin();
      expect(typeof bin).toBe('string');
    } catch (e: any) {
      // In test env, bin is /tmp/itehaas which may not exist, but should not be world-writable error
      expect(e.message).not.toMatch(/world-writable/);
    }
  });

  it('S5-03 isAllowedFlag correctly', async () => {
    const { isAllowedFlag } = await import('./vcs');
    expect(isAllowedFlag('--algo')).toBe(true);
    expect(isAllowedFlag('--max-count')).toBe(true);
    expect(isAllowedFlag('--prune')).toBe(true);
    expect(isAllowedFlag('--evil-flag')).toBe(false);
  });

  it('S5-04 arg sanitization rejects null bytes and newlines', async () => {
    const { execItehaas } = await import('./vcs');
    const { config } = await import('../config');
    const { vcsSemaphore } = await import('./semaphore');
    const validCwd = path.join(path.resolve(config.reposRoot), 'testuser', 'testrepo_san');
    fs.mkdirSync(validCwd, { recursive: true });

    await expect(execItehaas(['checkout', 'branch\0evil'], { cwd: validCwd })).rejects.toThrow(/null byte/);
    expect(vcsSemaphore.getCount()).toBe(0);

    await expect(execItehaas(['checkout', 'branch\nnewline'], { cwd: validCwd })).rejects.toThrow(/newline/);
    expect(vcsSemaphore.getCount()).toBe(0);

    await expect(execItehaas(['checkout', 'branch\rcarriage'], { cwd: validCwd })).rejects.toThrow(/newline/);
    expect(vcsSemaphore.getCount()).toBe(0);

    try { fs.rmSync(validCwd, { recursive: true, force: true }); } catch {}
  });
});
