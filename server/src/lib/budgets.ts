import * as fs from 'fs';
import * as path from 'path';

/**
 * S7: explicit resource budgets. Every expensive operation gets a time, memory,
 * disk, output, or concurrency budget. No unbounded collections, no unbounded
 * scans of attacker-controlled content.
 */

// ---- HTTP body budget ----
/** Max JSON body size (Fastify bodyLimit). All JSON endpoints fit far below this. */
export const MAX_JSON_BODY_BYTES = 1_048_576; // 1 MiB

// ---- Collection budgets ----
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
export const MAX_LIST_OFFSET = 50_000;

export interface Pagination {
  limit: number;
  offset: number;
}

/** Parse ?limit=&offset= with S7 bounds. Never returns an unbounded page. */
export function parsePagination(
  q: any,
  def: number = DEFAULT_LIST_LIMIT,
  max: number = MAX_LIST_LIMIT,
  maxOffset: number = MAX_LIST_OFFSET
): Pagination | { error: string } {
  const rawLimit = q?.limit;
  const rawOffset = q?.offset;
  const limit = rawLimit === undefined ? def : parseInt(String(rawLimit), 10);
  const offset = rawOffset === undefined ? 0 : parseInt(String(rawOffset), 10);
  if (!Number.isFinite(limit) || limit < 1) return { error: 'invalid limit' };
  if (!Number.isFinite(offset) || offset < 0) return { error: 'invalid offset' };
  if (offset > maxOffset) return { error: 'offset too large' };
  return { limit: Math.min(limit, max), offset };
}

// ---- SQL LIKE budget ----
/** Escape LIKE wildcards so `q=%%` cannot turn a 2-char query into a full-table scan. */
export function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ---- CI output budgets ----
/** Max captured log bytes per CI job (stdout+stderr combined). */
export const MAX_CI_LOG_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Max combined shell script bytes per job (defense in depth behind workflow limits). */
export const MAX_CI_SCRIPT_BYTES = 256 * 1024; // 256 KiB
/** Max jobs/artifacts rows returned per pipeline detail response. */
export const MAX_CI_DETAIL_ROWS = 100;

// ---- Repository disk budget ----
/** Default per-repository disk quota for `.itehaas` storage. Overridable via env. */
export const DEFAULT_REPO_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

export function repoQuotaBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REPO_QUOTA_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_REPO_QUOTA_BYTES;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1024 * 1024) return DEFAULT_REPO_QUOTA_BYTES;
  return n;
}

/**
 * Disk usage of a repository's `.itehaas` dir (lstat, never follows symlinks).
 * Stops early once `stopAbove` is exceeded — O(n) worst case only for repos
 * under quota, constant work for repos already over it.
 */
export function getRepoDiskUsage(repoPath: string, stopAbove: number = Number.MAX_SAFE_INTEGER): number {
  let total = 0;
  const root = path.join(repoPath, '.itehaas');
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        total += st.size;
        if (total > stopAbove) return total;
      }
    }
  }
  return total;
}
