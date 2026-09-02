import { spawn } from 'child_process';
import * as path from 'path';
import { config } from '../config';

export interface VcsResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const HASH_REGEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1 << 20; // 1 MiB cap per stream

export function validateHash(hash: string): void {
  if (!HASH_REGEX.test(hash)) {
    throw new Error(`invalid hash: ${hash}`);
  }
}

function validateRepoPath(repoPath: string): void {
  const resolvedRoot = path.resolve(config.reposRoot);
  const resolved = path.resolve(repoPath);
  if (resolved === resolvedRoot) {
    throw new Error('repo path cannot be repos root itself');
  }
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('path traversal not allowed');
  }
  if (resolved.includes('\0')) throw new Error('invalid path');
}

export function repoPathFor(owner: string, repo: string): string {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) {
    throw new Error('invalid owner/repo');
  }
  const p = path.join(path.resolve(config.reposRoot), owner, repo);
  validateRepoPath(p);
  return p;
}

export function execItehaas(args: string[], opts: { cwd?: string; input?: string | Buffer; timeout?: number } = {}): Promise<VcsResult> {
  return new Promise((resolve, reject) => {
    const bin = config.itehaasBin;
    const timeout = opts.timeout ?? TIMEOUT_MS;

    // Basic arg sanitization: no null bytes, no shell metachars as separate arg is safe but guard
    for (const a of args) {
      if (a.includes('\0')) return reject(new Error('invalid arg: null byte'));
    }

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // force kill after grace
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
    }, timeout);

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      if (stdoutLen + s.length > MAX_OUTPUT) {
        stdout += s.slice(0, MAX_OUTPUT - stdoutLen);
        stdoutLen = MAX_OUTPUT;
      } else {
        stdout += s;
        stdoutLen += s.length;
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      if (stderrLen + s.length > MAX_OUTPUT) {
        stderr += s.slice(0, MAX_OUTPUT - stderrLen);
        stderrLen = MAX_OUTPUT;
      } else {
        stderr += s;
        stderrLen += s.length;
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`itehaas timeout after ${timeout}ms: ${args.join(' ')}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });

    if (opts.input) {
      try {
        child.stdin.write(opts.input);
      } catch {}
      child.stdin.end();
    }
  });
}

export async function initRepo(repoPath: string, algo: string = 'sha256'): Promise<void> {
  validateRepoPath(repoPath);
  if (!['sha256'].includes(algo)) throw new Error(`unsupported algo: ${algo}`);
  const res = await execItehaas(['init', repoPath, '--algo', algo]);
  if (res.code !== 0) {
    throw new Error(`itehaas init failed: ${res.stderr || res.stdout}`);
  }
}

export async function getHeadHash(repoPath: string): Promise<string | null> {
  validateRepoPath(repoPath);
  const res = await execItehaas(['log', '--oneline'], { cwd: repoPath });
  if (res.code !== 0) return null;
  const line = res.stdout.trim().split('\n')[0];
  if (!line) return null;
  const hash = line.split(' ')[0];
  if (HASH_REGEX.test(hash)) return hash;
  // hash is short 7 chars in log --oneline, not full; so we need full hash via rev-parse equivalent
  // Fallback: try to read HEAD ref via config? For now return null to indicate need for full hash path
  return null;
}

export async function catFile(repoPath: string, hash: string, pretty = true): Promise<string> {
  validateHash(hash);
  validateRepoPath(repoPath);
  const args = ['cat-file', pretty ? '-p' : '-t', hash];
  const res = await execItehaas(args, { cwd: repoPath });
  if (res.code !== 0) throw new Error(res.stderr || 'cat-file failed');
  return res.stdout;
}

export async function listTree(repoPath: string, hash: string): Promise<{ mode: string; hash: string; name: string }[]> {
  validateHash(hash);
  validateRepoPath(repoPath);
  const out = await catFile(repoPath, hash, true);
  const entries: { mode: string; hash: string; name: string }[] = [];
  for (const line of out.trim().split('\n')) {
    if (!line.trim()) continue;
    // Format: "100644 <hash> <name>" (pretty) or raw? Use regex
    const m = line.trim().match(/^(\d{5,6})\s+([0-9a-f]{40,64})\s+(.+)$/);
    if (!m) continue;
    const [, mode, h, name] = m;
    if (!['100644', '100755', '40000'].includes(mode)) continue;
    entries.push({ mode, hash: h, name });
  }
  return entries;
}

export function isValidOwnerRepo(owner: string, repo: string): boolean {
  return /^[a-zA-Z0-9._-]{1,100}$/.test(owner) && /^[a-zA-Z0-9._-]{1,100}$/.test(repo);
}
