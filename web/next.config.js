/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

// S11: the web UI calls the API over fetch, often cross-origin in self-hosted
// split-port deployments (web :3000, api :3001) or via Tailscale names. A static
// `connect-src 'self'` in production would fail closed on legitimate API calls,
// so the configured API origin is allowlisted explicitly (still no wildcards).
const candidateOrigins = [];
for (const envVal of [process.env.NEXT_PUBLIC_API_URL, process.env.INTERNAL_API_URL]) {
  if (envVal) {
    try {
      const parsed = new URL(envVal).origin;
      if (parsed && parsed !== 'null') candidateOrigins.push(parsed);
    } catch {}
  }
}
if (candidateOrigins.length === 0) {
  candidateOrigins.push('http://localhost:3001');
}
const apiConnectSrc = Array.from(new Set(candidateOrigins)).map((o) => ` ${o}`).join('');

// Next.js App Router streaming & hydration requires inline scripts (self.__next_f.push).
// In production without nonces, script-src MUST include 'unsafe-inline' (while omitting 'unsafe-eval').
const cspHeader = isDev
  ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
  : `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'${apiConnectSrc}; frame-ancestors 'none'; object-src 'none'; base-uri 'self'`;

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['react-markdown', 'remark-gfm'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: cspHeader },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  async rewrites() {
    const upstream = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001').trim().replace(/\/+$/, '');
    if (!upstream) return [];
    return [
      {
        source: '/api/:path*',
        destination: `${upstream}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${upstream}/health`,
      },
    ];
  },
};
module.exports = nextConfig;
