import * as crypto from 'crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { config } from './config';
import { csrfCheck } from './middleware/csrf';
import { authRoutes } from './routes/auth';
import { repoRoutes } from './routes/repos';
import { issueRoutes } from './routes/issues';
import { pullRoutes } from './routes/pulls';
import { starRoutes } from './routes/stars';
import { ciRoutes } from './routes/ci';
import { userRoutes } from './routes/users';
import { orgRoutes } from './routes/orgs';
import { inviteRoutes } from './routes/invites';
import { searchRoutes } from './routes/search';
import { metrics, incHttpRequest, incAuthFailure, incRateLimited, renderMetrics } from './lib/metrics';

async function buildApp() {
  if (typeof (config as any).validateStartupConfig === 'function') {
    (config as any).validateStartupConfig(config);
  }
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-forwarded-for"]', 'req.headers["cookie"]'],
        censor: '***',
      },
    },
  });

  await app.register(fastifyCookie);
  // S11: helmet with CSP, HSTS, etc.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    noSniff: true,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    hidePoweredBy: true,
  });
  // S12/SEC-003: CORS allowlist — strict origin validation, reject null, maxAge preflight caching
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];
  const defaultProdOrigins = ['https://itehaas.tailnet.ts.net', 'https://itehaas.local'];
  const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : config.isProd
      ? defaultProdOrigins
      : [...devOrigins, ...defaultProdOrigins];

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === 'null') return cb(null, false);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-XSRF-Token', 'X-Requested-With'],
    maxAge: 86400,
  });

  // Support empty JSON bodies gracefully without throwing FST_ERR_CTP_EMPTY_JSON_BODY
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  // S11: CSRF double-submit for cookie-auth state-changing
  app.addHook('onRequest', async (req, reply) => {
    try {
      await csrfCheck(req as any, reply as any);
    } catch (e: any) {
      if (!reply.sent) {
        // Already sent 403 in csrfCheck, but ensure
        if (e.message === 'csrf validation failed') return;
        throw e;
      }
    }
  });

  // S14: global rate-limit per IP (skip CORS OPTIONS preflight)
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') {
      return;
    }
    const { checkRateLimit, rateLimitReply } = await import('./lib/rateLimit');
    // In development mode, allow 2000/min to accommodate Next.js React 18 StrictMode double-rendering and rapid dev browsing.
    // In test and production environments, strictly enforce the 100/min security ceiling.
    const limit = config.nodeEnv === 'development' ? 2000 : 100;
    const rl = checkRateLimit(req as any, 'global', limit, 60 * 1000);
    if (!rl.allowed) {
      return rateLimitReply(reply as any, rl.resetMs);
    }
  });

  // Metrics hook: count requests + structured security log (S18)
  app.addHook('onResponse', async (req, reply) => {
    incHttpRequest(req.method, reply.statusCode);
    if (reply.statusCode === 429) incRateLimited();
    if (reply.statusCode === 401 || reply.statusCode === 403) incAuthFailure();
    const ip = (req as any).ip;
    const userAgent = (req.headers['user-agent'] as string) || undefined;
    // Try to get userId if authenticated (best effort, don't fail)
    let userId: string | undefined;
    try {
      const { getSessionUser } = await import('./middleware/auth');
      const u = await getSessionUser(req as any);
      userId = u?.id;
    } catch {}
    const logData: any = { method: req.method, url: req.url, status: reply.statusCode, duration: reply.elapsedTime, ip, userAgent, userId };
    if (reply.statusCode === 401 || reply.statusCode === 403) {
      (req.log as any).warn(logData, 'auth_failure');
    } else if (reply.statusCode === 429) {
      (req.log as any).warn(logData, 'rate_limited');
    } else {
      req.log.info(logData, 'request completed');
    }
  });

  app.get('/health', async () => ({ ok: true, version: '0.1.0', uptime: Math.round((Date.now() - metrics.startTime)/1000) }));

  app.get('/metrics', async (_req, reply) => {
    const out = renderMetrics();
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send(out);
  });

  await app.register(authRoutes);
  await app.register(repoRoutes);
  await app.register(issueRoutes);
  await app.register(pullRoutes);
  await app.register(starRoutes);
  await app.register(ciRoutes);
  await app.register(userRoutes);
  await app.register(orgRoutes);
  await app.register(inviteRoutes);
  await app.register(searchRoutes);

  // Global error handler — S9/S16: redacted, CSPRNG correlationId, no path leak
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req as any).id || `req-${crypto.randomUUID()}`;
    app.log.error({ err, correlationId, method: req.method, url: req.url }, 'internal error');
    reply.status(500).send({ error: 'internal', correlationId });
  });

  return app;
}

if (require.main === module) {
  buildApp().then((app) => {
    app.listen({ port: config.port, host: config.host }, (err, address) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      console.log(`Server listening at ${address}`);
    });
  });
}

export { buildApp };
