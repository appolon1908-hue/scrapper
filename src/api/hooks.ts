import type { FastifyInstance } from 'fastify';
import { log } from '../log.js';
import { authenticateRequest } from '../security/auth.js';

const AUTHENTICATED_PREFIXES = ['/api/v2/', '/platform/v2/'] as const;
const protectedRoute = (url: string) =>
  AUTHENTICATED_PREFIXES.some((prefix) => url.startsWith(prefix));

export function installApiHooks(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');

    if (protectedRoute(request.url)) {
      const authenticated = await authenticateRequest(request, reply);
      if (!authenticated) return reply;
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const authenticatedRoute = protectedRoute(request.url);
    log('info', 'http_request', {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url || request.url.split('?')[0],
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime,
      tenantId: authenticatedRoute ? request.principal?.tenantId : undefined,
      clientId: authenticatedRoute ? request.principal?.clientId : undefined,
    });
  });
}
