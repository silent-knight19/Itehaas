import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import { config } from './config';
import { authRoutes } from './routes/auth';
import { repoRoutes } from './routes/repos';

async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  app.get('/health', async () => ({ ok: true, version: '0.1.0' }));

  await app.register(authRoutes);
  await app.register(repoRoutes);

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
