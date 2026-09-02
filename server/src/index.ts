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
  const app = Fastify({
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
  // S11: CORS allowlist — origin:true in dev, allowlist in prod
  const allowedOrigins = process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : config.isProd
      ? ['https://itehaas.tailnet.ts.net', 'https://itehaas.local']
      : true;
  await app.register(fastifyCors, {
    origin: allowedOrigins as any,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-XSRF-Token', 'X-Requested-With'],
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

  // S14: global rate-limit 100/min per IP (generous, to prevent flood)
  app.addHook('onRequest', async (req, reply) => {
    // Skip health/metrics from global limit? No, include but 100 is generous
    const { checkRateLimit, rateLimitReply } = await import('./lib/rateLimit');
    const rl = checkRateLimit(req as any, 'global', 100, 60 * 1000);
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

  // Global error handler — S9: redacted, correlationId, no path leak
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
