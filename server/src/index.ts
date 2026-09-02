import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { config } from './config';
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
import { metrics, incHttpRequest, renderMetrics } from './lib/metrics';

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
    },
  });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // Metrics hook: count requests + structured log
  app.addHook('onResponse', async (req, reply) => {
    incHttpRequest(req.method, reply.statusCode);
    req.log.info({ method: req.method, url: req.url, status: reply.statusCode, duration: reply.elapsedTime }, 'request completed');
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

  // Global error handler
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    reply.status(500).send({ error: 'internal' });
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
