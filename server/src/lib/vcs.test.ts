import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

// Mock config to control reposRoot
vi.mock('../config', () => ({
  config: {
    reposRoot: path.join(process.cwd(), 'data/repos'),
    itehaasBin: path.join(process.cwd(), 'target/debug/itehaas'),
    databaseUrl: 'postgres://itehaas:itehaas@localhost:5432/itehaas_test',
  },
}));

import { repoPathFor, validateHash, isValidOwnerRepo } from './vcs';

describe('vcs lib', () => {
  it('repoPathFor valid', () => {
    const p = repoPathFor('alice', 'my-repo');
    expect(p).toContain(path.join('data/repos', 'alice', 'my-repo'));
    expect(p).not.toContain('..');
  });

  it('repoPathFor invalid owner', () => {
    expect(() => repoPathFor('../etc', 'repo')).toThrow(/invalid owner/);
    expect(() => repoPathFor('alice', '../repo')).toThrow(/invalid owner/);
    expect(() => repoPathFor('alice', 'repo/..')).toThrow(/invalid owner/);
  });

  it('repoPathFor traversal blocked', () => {
    // Should throw for path traversal via owner/repo
    expect(() => repoPathFor('alice', 'a/b')).toThrow(); // slash not allowed per regex
    expect(() => repoPathFor('alice', '..')).toThrow(); // '..' -> traversal to parent
    expect(() => repoPathFor('..', 'repo')).toThrow();
  });

  it('validateHash valid', () => {
    const good = 'a'.repeat(64);
    expect(() => validateHash(good)).not.toThrow();
  });

  it('validateHash invalid', () => {
    expect(() => validateHash('abc')).toThrow(/invalid hash/);
    expect(() => validateHash('g'.repeat(64))).toThrow(/invalid hash/);
    expect(() => validateHash('A'.repeat(64))).toThrow(/invalid hash/);
  });

  it('isValidOwnerRepo', () => {
    expect(isValidOwnerRepo('alice', 'repo-1')).toBe(true);
    expect(isValidOwnerRepo('alice', 'repo/1')).toBe(false);
    expect(isValidOwnerRepo('', 'repo')).toBe(false);
    expect(isValidOwnerRepo('alice', '')).toBe(false);
  });
});
