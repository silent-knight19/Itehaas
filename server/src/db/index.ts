import { Pool } from 'pg';
import { config } from '../config';

// S8: least-privilege runtime role. When DATABASE_APP_URL is set (see
// database/migrations/011_db_roles.sql runbook), the pool connects as the
// DML-only `itehaas_app` role instead of the owner. Migrations (db/migrate.ts)
// must keep using the owner DATABASE_URL.
function resolveConnectionString(): string {
  const appUrl = process.env.DATABASE_APP_URL;
  if (appUrl && appUrl.trim() !== '') return appUrl;
  return config.databaseUrl;
}

export function isLeastPrivilegeDb(): boolean {
  const appUrl = process.env.DATABASE_APP_URL;
  return !!appUrl && appUrl.trim() !== '';
}

export const pool = new Pool({
  connectionString: resolveConnectionString(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // S8: bound connection wait
  // S8: statement timeout 5s via options (also set per-connect)
  options: '-c statement_timeout=5000',
});

pool.on('connect', (client) => {
  // S8: ensure statement_timeout even if options not respected
  client.query('SET statement_timeout = 5000').catch(() => {});
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err);
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

/**
 * S8: Fail-safe, leak-proof transaction wrapper with automatic ROLLBACK on error
 * and guaranteed connection release in finally block.
 */
export async function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export function hashStringToInt(s: string): number {
  // S15: legacy 31-bit advisory-lock hash (kept for backward-compatible tests).
  // Prefer advisoryLockKeys() below: 64-bit FNV-1a split avoids cross-repo
  // collisions that caused spurious 423s (FSEC-021).
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  // Ensure non-zero and within 32-bit signed
  return h & 0x7fffffff;
}

/**
 * S15: 64-bit FNV-1a repo identity split into the two signed 31-bit halves used
 * by the two-argument `pg_try_advisory_lock(classid, objid)` form. One key per
 * repository, shared by push/merge/delete so ref-mutating operations exclude
 * each other (previously merge used a different key and raced pushes).
 */
export function advisoryLockKeys(repoId: string): [number, number] {
  let h = 0xcbf29ce484222325n;
  const s = `repo:${repoId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return [Number(h & 0x7fffffffn), Number((h >> 32n) & 0x7fffffffn)];
}

/**
 * S15: session-pinned advisory-lock primitives. `pg_advisory_lock` is
 * session-scoped, but `pool.query` may hit a different backend per call —
 * locking on one connection and unlocking on another leaks the lock forever
 * (later 423s) while LOOKING safe. Callers therefore pin ONE client (via
 * route-level `getClient`, which stays mockable in tests) for the whole
 * critical section and pass it here. These helpers never acquire clients
 * themselves, so unit tests can drive them with fake clients (no PG needed).
 */
export async function lockClientAdvisory(client: any, key: [number, number]): Promise<boolean> {
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', key);
    return !!res.rows[0]?.locked;
  } catch {
    return false;
  }
}

export async function unlockClientAdvisory(client: any, key: [number, number]): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock($1,$2)', key);
  } catch {}
}

export async function ping() {
  const c = await pool.connect();
  try {
    await c.query('SELECT 1');
    return true;
  } finally {
    c.release();
  }
}
