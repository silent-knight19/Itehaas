import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
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
  // S15: for pg_advisory_xact_lock, need 32-bit int from UUID string
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  // Ensure non-zero and within 32-bit signed
  return h & 0x7fffffff;
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
