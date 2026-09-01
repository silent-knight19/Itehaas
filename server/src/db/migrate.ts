import * as fs from 'fs';
import * as path from 'path';
import { pool } from './index';

async function migrate() {
  const migrationsDir = path.join(__dirname, '../../../database/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  console.log(`Found ${files.length} migrations`);
  for (const file of files) {
    console.log(`Running ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    console.log(`✓ ${file}`);
  }
  console.log('Migrations complete');
  await pool.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
