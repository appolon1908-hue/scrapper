import type { FastifyRequest } from 'fastify';
import { ApiError } from '../error-handler.js';

export function header(request: FastifyRequest, name: string): string {
  return String(request.headers[name.toLowerCase()] || '').trim();
}

export function requiredHeader(
  request: FastifyRequest,
  name: string,
  errorCode: string,
  maxLength = 200,
): string {
  const value = header(request, name);
  if (!value || value.length > maxLength) {
    throw new ApiError(400, errorCode);
  }
  return value;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidParam(request: FastifyRequest, name: string): string {
  const value = String((request.params as Record<string, unknown>)[name] || '');
  if (!UUID_PATTERN.test(value)) throw new ApiError(400, `invalid_${name}`);
  return value;
}
