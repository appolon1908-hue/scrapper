import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../../persistence/db.js';
import { pingRedis } from '../../queues.js';

async function readOpenApiDocument(): Promise<string> {
  const packaged = new URL('../../../openapi/openapi.yaml', import.meta.url);
  return fs
    .readFile(packaged, 'utf8')
    .catch(() => fs.readFile(`${process.cwd()}/openapi/openapi.yaml`, 'utf8'));
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    service: 'codestra-business-scrapper',
    version: '2.0.0',
    api: '/api/v2',
    documentation: '/openapi.yaml',
    deployment_status: 'not_verified_live',
  }));

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await Promise.all([pingDatabase(), pingRedis()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/openapi.yaml', async (_request, reply) => {
    const value = await readOpenApiDocument();
    return reply.type('application/yaml; charset=utf-8').send(value);
  });
}
