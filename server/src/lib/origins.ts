/**
 * S12: single source of truth for browser-origin allowlisting, shared by CORS
 * (index.ts) and CSRF origin verification (middleware/csrf.ts). Previously each
 * file kept its own copy of the dev/prod lists — a drift between them would open
 * one boundary while closing the other.
 */

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

const DEFAULT_PROD_ORIGINS = ['https://itehaas.tailnet.ts.net', 'https://itehaas.local'];

/** Normalize one origin: trim, drop trailing slashes (which never match `Origin`). */
export function normalizeOrigin(s: string): string {
  return s.trim().replace(/\/+$/, '');
}

export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env, isProd?: boolean): string[] {
  const prod = isProd ?? env.NODE_ENV === 'production';
  if (env.ALLOWED_ORIGIN) {
    return env.ALLOWED_ORIGIN.split(',')
      .map(normalizeOrigin)
      .filter(Boolean);
  }
  return prod ? [...DEFAULT_PROD_ORIGINS] : [...DEV_ORIGINS, ...DEFAULT_PROD_ORIGINS];
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.includes(normalizeOrigin(origin));
}
