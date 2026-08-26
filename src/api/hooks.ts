import type { FastifyInstance } from 'fastify';
import { log } from '../log.js';
import { authenticateRequest } from '../security/auth.js';

const AUTHENTICATED_PREFIX = '/api/v2/';

export function installApiHooks(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');

    if (request.url.startsWith(AUTHENTICATED_PREFIX)) {
      const authenticated = await authenticateRequest(request, reply);
      if (!authenticated) return reply;
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const protectedRoute = request.url.startsWith(AUTHENTICATED_PREFIX);
    log('info', 'http_request', {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url || request.url.split('?')[0],
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime,
      tenantId: protectedRoute ? request.principal?.tenantId : undefined,
      clientId: protectedRoute ? request.principal?.clientId : undefined,
    });
  });
}
