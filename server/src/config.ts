import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load from server/.env when running via tsx (src), and from project root when running compiled
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  reposRoot: string;
  itehaasBin: string;
  cookieSecret: string;
  secretEncryptionKey: string;
  nodeEnv: string;
  isProd: boolean;
}

export function validateDatabaseUrl(url: string, isProduction: boolean): void {
  if (!url || typeof url !== 'string') {
    throw new Error('[config] DATABASE_URL must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('[config] DATABASE_URL is malformed: not a valid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`[config] DATABASE_URL must use postgres: or postgresql: protocol, got ${parsed.protocol}`);
  }
  if (!parsed.hostname) {
    throw new Error('[config] DATABASE_URL missing hostname');
  }
  if (isProduction) {
    const prohibitedPatterns = ['itehaas:itehaas', 'postgres:postgres'];
    for (const pat of prohibitedPatterns) {
      if (url.includes(pat) && !process.env.ALLOW_LOCAL_PROD_DB) {
        throw new Error(`[config] DATABASE_URL contains insecure default credentials "${pat}" in production. Rotate them.`);
      }
    }
  }
}

export function validateReposRoot(reposRoot: string, isProduction: boolean): void {
  if (!reposRoot || typeof reposRoot !== 'string') {
    throw new Error('[config] REPOS_ROOT must be a non-empty string');
  }
  if (reposRoot.includes('\0')) {
    throw new Error('[config] REPOS_ROOT contains forbidden null bytes');
  }
  const resolved = path.resolve(reposRoot);
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`[config] REPOS_ROOT exists but is not a directory: ${resolved}`);
    }
    // Check non-world-writable on POSIX
    if (process.platform !== 'win32' && (stat.mode & 0o002) !== 0) {
      throw new Error(`[config] REPOS_ROOT is insecure: world-writable directory (${stat.mode.toString(8)}): ${resolved}`);
    }
  } else if (isProduction) {
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) {
      throw new Error(`[config] REPOS_ROOT parent directory does not exist: ${parent}`);
    }
  }
}

export function validateItehaasBin(binPath: string, isProduction: boolean): void {
  if (!binPath || typeof binPath !== 'string') {
    throw new Error('[config] ITEHAAS_BIN must be a non-empty string');
  }
  if (binPath.includes('\0')) {
    throw new Error('[config] ITEHAAS_BIN contains forbidden null bytes');
  }
  const resolved = path.resolve(binPath);
  if (isProduction || process.env.VALIDATE_VCS_BIN === 'true') {
    if (!fs.existsSync(resolved)) {
      throw new Error(`[config] ITEHAAS_BIN executable not found at: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      throw new Error(`[config] ITEHAAS_BIN exists but is not a regular file: ${resolved}`);
    }
    if (process.platform !== 'win32') {
      if ((stat.mode & 0o111) === 0) {
        throw new Error(`[config] ITEHAAS_BIN is not executable: ${resolved}`);
      }
      if ((stat.mode & 0o002) !== 0) {
        throw new Error(`[config] ITEHAAS_BIN is insecure: world-writable binary (${stat.mode.toString(8)}): ${resolved}`);
      }
    }
  }
}

export function validateStartupConfig(cfg: AppConfig, env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env.NODE_ENV || cfg.nodeEnv || 'development';
  if (nodeEnv !== 'production' && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(`[config] Invalid NODE_ENV "${nodeEnv}". Expected "production", "development", or "test".`);
  }

  const isProduction = nodeEnv === 'production' || cfg.isProd;

  // 1. Production debug settings forbidden
  if (isProduction) {
    const debugFlags = [env.DEBUG, env.ITEHAAS_DEBUG];
    for (const flag of debugFlags) {
      if (flag === 'true' || flag === '1') {
        throw new Error('[config] DEBUG mode is forbidden in production environment.');
      }
    }
    const logLevel = (env.LOG_LEVEL || '').toLowerCase();
    if (logLevel === 'debug' || logLevel === 'trace') {
      throw new Error(`[config] Verbose LOG_LEVEL="${logLevel}" is forbidden in production environment.`);
    }
  }

  // 2. Secret validation
  const insecureCookiePatterns = [
    'dev-secret-change-me',
    'change-me-in-production',
    'changeme',
    'default-secret',
    'password123',
    '12345678',
    'itehaas',
  ];

  if (isProduction) {
    if (!cfg.cookieSecret || cfg.cookieSecret.length < 32) {
      throw new Error(`[config] COOKIE_SECRET too short in production (min 32 chars, got ${cfg.cookieSecret ? cfg.cookieSecret.length : 0}).`);
    }
    for (const pat of insecureCookiePatterns) {
      if (cfg.cookieSecret.toLowerCase().includes(pat)) {
        throw new Error(`[config] COOKIE_SECRET contains insecure default pattern "${pat}" in production. Rotate it.`);
      }
    }
  }

  // 3. Database URL validation
  validateDatabaseUrl(cfg.databaseUrl, isProduction);

  // 4. Repository root validation
  validateReposRoot(cfg.reposRoot, isProduction);

  // 5. VCS binary validation
  validateItehaasBin(cfg.itehaasBin, isProduction);

  // 6. Host binding in production
  if (isProduction && cfg.host === '0.0.0.0' && env.ALLOW_ALL_INTERFACES !== 'true') {
    throw new Error('[config] Binding to 0.0.0.0 is forbidden in production without ALLOW_ALL_INTERFACES=true.');
  }
}

function requireSecureSecret(name: string, value: string | undefined, minLen: number, insecurePatterns: string[], isProduction: boolean): string {
  const fallback = name === 'COOKIE_SECRET' ? 'dev-secret-change-me' : 'postgres://itehaas:itehaas@localhost:5432/itehaas';
  const val = value || fallback;
  if (isProduction) {
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

export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production';
  return {
    port: parseInt(env.PORT || '3001', 10),
    host: process.env.HOST || env.HOST || (isProd ? '127.0.0.1' : '0.0.0.0'),
    databaseUrl: requireSecureSecret('DATABASE_URL', env.DATABASE_URL, 20, ['itehaas:itehaas', 'postgres://itehaas:itehaas@localhost'], isProd),
    reposRoot: env.REPOS_ROOT || path.join(__dirname, '../../data/repos'),
    itehaasBin: env.ITEHAAS_BIN || path.join(__dirname, '../../target/debug/itehaas'),
    cookieSecret: requireSecureSecret('COOKIE_SECRET', env.COOKIE_SECRET, 32, ['dev-secret-change-me', 'change-me-in-production', 'changeme'], isProd),
    secretEncryptionKey: requireSecureSecret('SECRET_ENCRYPTION_KEY', env.SECRET_ENCRYPTION_KEY || env.COOKIE_SECRET, 32, ['dev-secret-change-me', 'change-me-in-production', 'changeme'], isProd),
    nodeEnv: env.NODE_ENV || 'development',
    isProd,
  };
}

export const config = {
  ...createConfig(process.env),
  validateStartupConfig,
};
