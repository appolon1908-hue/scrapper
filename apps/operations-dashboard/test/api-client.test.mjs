import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, DashboardApiClient } from '../api-client.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('API client binds tenant and same-origin credentials', async () => {
  let observed;
  const client = new DashboardApiClient({
    baseUrl: 'https://api.example.test/',
    tenantId: 'tenant-a',
    getAccessToken: async () => 'session-token',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return jsonResponse({ items: [], next_cursor: null });
    },
  });

  await client.listJobs({ status: 'running', limit: 25 });
  assert.equal(observed.url, 'https://api.example.test/api/v2/jobs?status=running&limit=25');
  assert.equal(observed.options.credentials, 'same-origin');
  assert.equal(observed.options.headers.get('x-tenant-id'), 'tenant-a');
  assert.equal(observed.options.headers.get('authorization'), 'Bearer session-token');
});

test('create command adds correlation and idempotency headers', async () => {
  let observed;
  const client = new DashboardApiClient({
    fetchImpl: async (_url, options) => {
      observed = options;
      return jsonResponse({ id: 'job-1', duplicate: false }, 202);
    },
  });

  await client.createJob(
    { seedUrls: ['https://example.com/'] },
    { correlationId: 'correlation-1', idempotencyKey: 'idempotency-1' },
  );
  assert.equal(observed.method, 'POST');
  assert.equal(observed.headers.get('x-correlation-id'), 'correlation-1');
  assert.equal(observed.headers.get('idempotency-key'), 'idempotency-1');
  assert.deepEqual(JSON.parse(observed.body), { seedUrls: ['https://example.com/'] });
});

test('API errors preserve status, code, request identity, and details', async () => {
  const client = new DashboardApiClient({
    fetchImpl: async () =>
      jsonResponse(
        { error: 'forbidden', request_id: 'request-9', details: { required: 'jobs:read' } },
        403,
      ),
  });

  await assert.rejects(
    client.listJobs(),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.code === 'forbidden' &&
      error.requestId === 'request-9' &&
      error.details.required === 'jobs:read',
  );
});

test('network failures become stable API errors', async () => {
  const client = new DashboardApiClient({
    fetchImpl: async () => {
      throw new Error('connection refused');
    },
  });
  await assert.rejects(client.health(), (error) => error.code === 'network_error');
});
