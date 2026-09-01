import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
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

export async function ping() {
  const c = await pool.connect();
  try {
    await c.query('SELECT 1');
    return true;
  } finally {
    c.release();
  }
}
