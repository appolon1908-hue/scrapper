import type { FastifyInstance } from 'fastify';
import { log } from '../log.js';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly details: unknown | undefined = undefined,
  ) {
    super(code);
  }
}

const KNOWN_ERRORS: Record<string, { statusCode: number; code: string }> = {
  idempotency_conflict: { statusCode: 409, code: 'idempotency_conflict' },
  not_found: { statusCode: 404, code: 'not_found' },
  job_not_found: { statusCode: 404, code: 'not_found' },
  invalid_cursor: { statusCode: 400, code: 'invalid_cursor' },
  invalid_tenant_transition: { statusCode: 409, code: 'invalid_tenant_transition' },
};

export function installApiErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      error: 'route_not_found',
      request_id: request.id,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      await reply.code(error.statusCode).send({
        error: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
        request_id: request.id,
      });
      return;
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === 'string' && error
          ? error
          : 'internal_error';
    const known = KNOWN_ERRORS[message];
    if (known) {
      await reply.code(known.statusCode).send({
        error: known.code,
        request_id: request.id,
      });
      return;
    }

    log('error', 'http_request_failed', {
      requestId: request.id,
      error: message,
    });
    await reply.code(500).send({
      error: 'internal_error',
      request_id: request.id,
    });
  });
}
