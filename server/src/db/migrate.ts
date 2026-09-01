import * as fs from 'fs';
import * as path from 'path';
import { pool } from './index';

function resolveMigrationsDir(): string {
  const candidates = [
    path.join(__dirname, '../../../database/migrations'), // src -> database/migrations
    path.join(__dirname, '../../database/migrations'), // dist/src/db -> database/migrations (when compiled to dist)
    path.join(process.cwd(), 'database/migrations'),
    path.join(__dirname, '../database/migrations'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // fallback to first candidate for error messaging
  return candidates[0];
}

async function migrate() {
  const migrationsDir = resolveMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`migrations dir not found: ${migrationsDir}`);
  }
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log(`Found ${files.length} migrations in ${migrationsDir}`);

  // Ensure migrations tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const appliedRes = await pool.query(`SELECT name FROM _migrations`);
  const applied = new Set(appliedRes.rows.map((r: any) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`— ${file} already applied, skipping`);
      continue;
    }
    console.log(`Running ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`✓ ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  console.log('Migrations complete');
  await pool.end();
}

if (require.main === module) {
  migrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { migrate };
