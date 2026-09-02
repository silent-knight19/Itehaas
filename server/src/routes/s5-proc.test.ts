import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAllowedEnv, isAllowedFlag, execItehaas } from '../lib/vcs';

describe('Phase S5: Process Execution Security & Subprocess Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SEC-016: Environment sanitization strips dangerous loader and runtime injection variables', () => {
    const originalEnv = { ...process.env };
    try {
      process.env.LD_PRELOAD = '/tmp/evil.so';
      process.env.LD_LIBRARY_PATH = '/tmp/evil_libs';
      process.env.DYLD_INSERT_LIBRARIES = '/tmp/evil_mac.dylib';
      process.env.DYLD_LIBRARY_PATH = '/tmp/evil_mac_libs';
      process.env.NODE_OPTIONS = '--require /tmp/evil.js';
      process.env.PYTHONPATH = '/tmp/evil_python';
      process.env.RUBYLIB = '/tmp/evil_ruby';
      process.env.PERL5LIB = '/tmp/evil_perl';
      process.env.SECRET_KEY = 'supersecret';

      const sanitized = getAllowedEnv();

      expect(sanitized.LD_PRELOAD).toBeUndefined();
      expect(sanitized.LD_LIBRARY_PATH).toBeUndefined();
      expect(sanitized.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(sanitized.DYLD_LIBRARY_PATH).toBeUndefined();
      expect(sanitized.NODE_OPTIONS).toBeUndefined();
      expect(sanitized.PYTHONPATH).toBeUndefined();
      expect(sanitized.RUBYLIB).toBeUndefined();
      expect(sanitized.PERL5LIB).toBeUndefined();
      expect(sanitized.SECRET_KEY).toBeUndefined();

      // Only standard system variables are retained
      expect(sanitized.PATH).toBeDefined();
      expect(sanitized.LANG).toBeDefined();
    } finally {
      process.env = originalEnv;
    }
  });

  it('SEC-016: Flag allowlist permits safe VCS flags and rejects flag injection', () => {
    // Permitted flags
    expect(isAllowedFlag('--is-ancestor')).toBe(true);
    expect(isAllowedFlag('--oneline')).toBe(true);
    expect(isAllowedFlag('-m')).toBe(true);
    expect(isAllowedFlag('--stat')).toBe(true);
    expect(isAllowedFlag('-f')).toBe(true);

    // Malicious or unapproved flags
    expect(isAllowedFlag('--exec')).toBe(false);
    expect(isAllowedFlag('--eval')).toBe(false);
    expect(isAllowedFlag('--output')).toBe(false);
    expect(isAllowedFlag('-e')).toBe(false);
    expect(isAllowedFlag('--upload-pack')).toBe(false);
  });

  it('SEC-016: execItehaas rejects null bytes and newlines in arguments before process spawn', async () => {
    await expect(execItehaas(['cat-file', '-p\0bad', 'abc'])).rejects.toThrow(/null byte/);
    await expect(execItehaas(['commit', '-m', 'line1\nline2'])).rejects.toThrow(/newline/);
  });

  it('SEC-016: execItehaas rejects unapproved flag injection in positional arguments', async () => {
    await expect(execItehaas(['branch', '--arbitrary-flag'])).rejects.toThrow(/invalid arg flag/);
    await expect(execItehaas(['checkout', '-x'])).rejects.toThrow(/invalid arg flag/);
  });
});
