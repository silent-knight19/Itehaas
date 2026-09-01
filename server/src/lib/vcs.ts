import { spawn } from 'child_process';
import * as path from 'path';
import { config } from '../config';

export interface VcsResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function validateHash(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`invalid hash: ${hash}`);
  }
}

function validateRepoPath(repoPath: string): void {
  if (repoPath.includes('..')) throw new Error('path traversal not allowed');
  if (!path.isAbsolute(repoPath) && repoPath.includes('/')) {
    // repoPath should be absolute after resolution
  }
}

export function repoPathFor(owner: string, repo: string): string {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) {
    throw new Error('invalid owner/repo');
  }
  const p = path.join(path.resolve(config.reposRoot), owner, repo);
  validateRepoPath(p);
  return p;
}

export function execItehaas(args: string[], opts: { cwd?: string; input?: string | Buffer } = {}): Promise<VcsResult> {
  return new Promise((resolve, reject) => {
    const bin = config.itehaasBin;
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export async function initRepo(repoPath: string): Promise<void> {
  validateRepoPath(repoPath);
  const res = await execItehaas(['init', repoPath]);
  if (res.code !== 0) {
    throw new Error(`itehaas init failed: ${res.stderr || res.stdout}`);
  }
}

export async function getHeadHash(repoPath: string): Promise<string | null> {
  // Try to read via cat-file? Simpler: read refs
  const res = await execItehaas(['log', '--oneline'], { cwd: repoPath });
  // Not needed for now
  return null;
}

export async function catFile(repoPath: string, hash: string, pretty = true): Promise<string> {
  validateHash(hash);
  const args = ['cat-file', pretty ? '-p' : '-t', hash];
  const res = await execItehaas(args, { cwd: repoPath });
  if (res.code !== 0) throw new Error(res.stderr || 'cat-file failed');
  return res.stdout;
}

export async function listTree(repoPath: string, hash: string): Promise<{ mode: string; hash: string; name: string }[]> {
  validateHash(hash);
  const out = await catFile(repoPath, hash, true);
  // Tree pretty: "100644 <hash> <name>"
  const entries: { mode: string; hash: string; name: string }[] = [];
  for (const line of out.trim().split('\n')) {
    if (!line.trim()) continue;
    const [mode, hash, ...rest] = line.trim().split(/\s+/);
    const name = rest.join(' ');
    if (mode && hash && name) entries.push({ mode, hash, name });
  }
  return entries;
}

// For push/fetch, we delegate to itehaas remote operations via CLI if needed
// Phase 6: server will expose git-like HTTP endpoints that internally use itehaas push/fetch
