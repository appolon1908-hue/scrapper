import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Repository } from '../persistence/repository.js';
import { installApiErrorHandling } from './error-handler.js';
import { installApiHooks } from './hooks.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerOperationsRoutes } from './routes/operations.js';
import { registerSystemRoutes } from './routes/system.js';

export async function buildApp(repository = new Repository()): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_000_000,
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
    trustProxy: false,
    disableRequestLogging: true,
  });

  installApiErrorHandling(app);
  installApiHooks(app);
  await registerSystemRoutes(app);
  await registerJobRoutes(app, repository);
  await registerOperationsRoutes(app, repository);

  return app;
}
