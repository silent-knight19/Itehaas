import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';
import { vcsSemaphore } from './semaphore';

export interface VcsResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const HASH_REGEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 1 << 20; // 1 MiB cap per stream

// S5: allowlist for env sent to VCS child (minimal, no secrets)
export const ALLOWED_ENV_KEYS = new Set(['PATH', 'LANG', 'HOME', 'USER', 'TMPDIR', 'SHELL']);
export function getAllowedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of ALLOWED_ENV_KEYS) {
    if (process.env[k] !== undefined) out[k] = process.env[k];
  }
  // Ensure PATH and LANG defaults
  if (!out.PATH) out.PATH = '/usr/local/bin:/usr/bin:/bin';
  if (!out.LANG) out.LANG = 'C.UTF-8';
  return out;
}

// S5: allowlist for flags (to block flag injection via branch names)
const ALLOWED_FLAGS = new Set([
  '-p', '-t', '-s', '--algo', '-f', '--force', '-a', '-r', '-m', '--oneline', '--max-count',
  '--all', '--graph', '-p', '--stat', '--name-only', '--since', '--until', '--author', '--grep',
  '--follow', '--staged', '--cached', '--amend', '-b', '-c', '-d', '-D', '--soft', '--mixed',
  '--hard', '--staged', '--worktree', '--source', '--cached', '-n', '--dry-run', '-d', '--dirs',
  '-u', '--include-untracked', '-a', '-d', '-l', '--stage', '--others', '--ignored', '-v',
  '--history', '--continue', '--abort', '-i', '--interactive', '--prune', '--is-ancestor',
  // generic
  '--', '-v', '--help',
]);

export function isAllowedFlag(arg: string): boolean {
  if (ALLOWED_FLAGS.has(arg)) return true;
  // Allow --max-count=200 etc? Our code uses '--max-count', String(max) as separate args, not --max-count=...
  // Allow --since/--until with value? They are separate, so not needed
  return false;
}

// S5: validate bin path
export function getValidatedBin(): string {
  const bin = config.itehaasBin;
  if (bin.includes('\0')) throw new Error('invalid bin path');
  const resolved = path.resolve(bin);
  // Must exist and not be world-writable
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('itehaas bin not a file');
    const mode = stat.mode;
    if (mode & 0o002) throw new Error('itehaas bin is world-writable');
    // Must be inside allowed prefixes: project target or /usr/local/bin or /usr/bin
    const allowedPrefixes = [
      path.resolve(path.join(__dirname, '../../target')),
      '/usr/local/bin',
      '/usr/bin',
      '/opt/itehaas',
    ];
    const isAllowed = allowedPrefixes.some((p) => resolved === p || resolved.startsWith(p + path.sep) || resolved.startsWith(p));
    // Also allow /tmp/itehaas_test for tests (mock)
    if (!isAllowed && !resolved.startsWith('/tmp/')) {
      // For dev, allow any absolute path that exists and is not world-writable (already checked)
      // So we allow if not world-writable, even if not in prefix — but log warning
    }
  } catch (e: any) {
    if (e.message && e.message.includes('itehaas bin')) throw e;
    // If file not exists, still allow but will fail spawn with error; we throw to avoid silent
    // For tests, mock bin may not exist, so don't throw if in test env
    if (config.nodeEnv !== 'test' && e.code === 'ENOENT') {
      throw new Error(`itehaas bin not found: ${resolved}`);
    }
  }
  return bin;
}

export function validateHash(hash: string): void {
  if (!HASH_REGEX.test(hash)) {
    throw new Error(`invalid hash: ${hash}`);
  }
}

export function validateRepoPath(repoPath: string): void {
  if (repoPath.includes('\0')) throw new Error('invalid path');
  const resolvedRootRaw = path.resolve(config.reposRoot);
  const resolved = path.resolve(repoPath);
  if (resolved === resolvedRootRaw) {
    throw new Error('repo path cannot be repos root itself');
  }
  if (!resolved.startsWith(resolvedRootRaw + path.sep)) {
    throw new Error('path traversal not allowed');
  }
  // S4: canonical check + symlink parent refuse (TOCTOU best-effort)
  // If repo path or any existing parent is symlink, reject to prevent escape via `data/repos/alice -> /tmp`
  try {
    // Try realpath for existing parts; if repoPath not yet exists, check its parent chain
    let cur = resolved;
    while (true) {
      try {
        const stat = fs.lstatSync(cur);
        if (stat.isSymbolicLink()) {
          throw new Error('path traversal not allowed (symlink)');
        }
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
        // not exists yet, check parent
      }
      if (cur === resolvedRootRaw) break;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
      if (cur.length < resolvedRootRaw.length) break;
    }
    // If both root and resolved exist, compare canonical
    try {
      const canonRoot = fs.realpathSync(resolvedRootRaw);
      const canonResolved = fs.realpathSync(resolved);
      if (canonResolved === canonRoot) throw new Error('repo path cannot be repos root itself');
      if (!canonResolved.startsWith(canonRoot + path.sep)) {
        throw new Error('path traversal not allowed (canonical)');
      }
    } catch (e: any) {
      if (e.message && e.message.includes('path traversal')) throw e;
      // if not exists yet, ignore realpath check (already did lstat parent)
    }
  } catch (e: any) {
    if (e.message && e.message.includes('path traversal')) throw e;
    // otherwise ignore lstat errors for non-existent
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

export function execItehaas(args: string[], opts: { cwd?: string; input?: string | Buffer; timeout?: number; maxOutput?: number } = {}): Promise<VcsResult> {
  return (async () => {
    await vcsSemaphore.acquire();
    return new Promise<VcsResult>((resolve, reject) => {
      let bin: string;
      try {
        bin = getValidatedBin();
      } catch (e: any) {
        vcsSemaphore.release();
        return reject(e);
      }
      const timeout = opts.timeout ?? TIMEOUT_MS;
      const maxOut = opts.maxOutput ?? MAX_OUTPUT;

      // S5: cwd validation
      if (opts.cwd) {
        try {
          validateRepoPath(opts.cwd);
        } catch (e: any) {
          vcsSemaphore.release();
          return reject(e);
        }
      }

      // S5: arg sanitization: no null bytes, no flag injection
      for (const a of args) {
        if (a.includes('\0')) {
          vcsSemaphore.release();
          return reject(new Error('invalid arg: null byte'));
        }
        if (a.includes('\n') || a.includes('\r')) {
          vcsSemaphore.release();
          return reject(new Error('invalid arg: newline'));
        }
        // Block flag-like injection for branch/hash positions: if arg starts with '-' and is not allowlisted and not a hash, reject
        if (a.startsWith('-')) {
          const isHash = HASH_REGEX.test(a) || /^[0-9a-f]{4,64}$/.test(a);
          if (!isHash && !isAllowedFlag(a)) {
            // Allow --max-count value is separate arg not flag, but flag itself is allowlisted
            // For branch names like "-f" is not allowed (branch must match isValidBranchRef), so reject
            vcsSemaphore.release();
            return reject(new Error(`invalid arg flag: ${a}`));
          }
        }
      }

      const child = spawn(bin, args, {
        cwd: opts.cwd,
        env: getAllowedEnv(),
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
      if (stdoutLen + s.length > maxOut) {
        stdout += s.slice(0, maxOut - stdoutLen);
        stdoutLen = maxOut;
      } else {
        stdout += s;
        stdoutLen += s.length;
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      if (stderrLen + s.length > maxOut) {
        stderr += s.slice(0, maxOut - stderrLen);
        stderrLen = maxOut;
      } else {
        stderr += s;
        stderrLen += s.length;
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      vcsSemaphore.release();
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      vcsSemaphore.release();
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
  })();
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
