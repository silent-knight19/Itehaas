import * as dotenv from 'dotenv';
import * as path from 'path';

// Load from server/.env when running via tsx (src), and from project root when running compiled
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

const rawDatabaseUrl = process.env.DATABASE_URL;
const rawCookieSecret = process.env.COOKIE_SECRET;
const isProd = process.env.NODE_ENV === 'production';

function requireSecureSecret(name: string, value: string | undefined, minLen: number, insecurePatterns: string[]): string {
  const fallback = name === 'COOKIE_SECRET' ? 'dev-secret-change-me' : 'postgres://itehaas:itehaas@localhost:5432/itehaas';
  const val = value || fallback;
  if (isProd) {
    if (!value) {
      throw new Error(`[config] ${name} is required in production (got fallback). Set ${name} env var (min ${minLen} chars).`);
    }
    if (val.length < minLen) {
      throw new Error(`[config] ${name} too short in production (min ${minLen} chars, got ${val.length}).`);
    }
    for (const pat of insecurePatterns) {
      if (val.includes(pat)) {
        throw new Error(`[config] ${name} contains insecure default pattern "${pat}" in production. Rotate it.`);
      }
    }
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || (isProd ? '127.0.0.1' : '0.0.0.0'),
  databaseUrl: requireSecureSecret('DATABASE_URL', rawDatabaseUrl, 20, ['itehaas:itehaas', 'postgres://itehaas:itehaas@localhost']),
  reposRoot: process.env.REPOS_ROOT || path.join(__dirname, '../../data/repos'),
  itehaasBin: process.env.ITEHAAS_BIN || path.join(__dirname, '../../target/debug/itehaas'),
  cookieSecret: requireSecureSecret('COOKIE_SECRET', rawCookieSecret, 32, ['dev-secret-change-me', 'change-me-in-production', 'changeme']),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
};
