import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, DashboardApiClient } from '../api-client.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function textResponse(body, contentType = 'text/plain', status = 200) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('API client binds tenant, authorization, credentials, and no-store caching', async () => {
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
  assert.equal(observed.options.cache, 'no-store');
  assert.equal(observed.options.headers.get('x-tenant-id'), 'tenant-a');
  assert.equal(observed.options.headers.get('authorization'), 'Bearer session-token');
});

test('documented read endpoints use exact paths and preserve text responses', async () => {
  const paths = [];
  const client = new DashboardApiClient({
    fetchImpl: async (url) => {
      paths.push(url);
      if (url === '/openapi.yaml') return textResponse('openapi: 3.1.0\n', 'application/yaml');
      if (url === '/api/v2/metrics') return textResponse('# TYPE scrapper_process_uptime_seconds gauge\n');
      if (url.includes('/results')) return jsonResponse({ items: [], next_cursor: null });
      if (url.startsWith('/api/v2/jobs/')) return jsonResponse({ id: 'job-1' });
      if (url === '/api/v2/jobs?limit=1') return jsonResponse({ items: [], next_cursor: null });
      return jsonResponse({ status: 'ok', service: 'scrapper', api: '/api/v2' });
    },
  });

  await client.serviceInfo();
  await client.health();
  await client.readiness();
  assert.match(await client.openApiDocument(), /openapi: 3\.1\.0/);
  await client.capabilities();
  await client.stats();
  assert.match(await client.metrics(), /# TYPE/);
  await client.listJobs({ limit: 1 });
  await client.getJob('job-1');
  await client.listResults('job-1', { limit: 1 });

  assert.deepEqual(paths, [
    '/',
    '/healthz',
    '/readyz',
    '/openapi.yaml',
    '/api/v2/capabilities',
    '/api/v2/stats',
    '/api/v2/metrics',
    '/api/v2/jobs?limit=1',
    '/api/v2/jobs/job-1',
    '/api/v2/jobs/job-1/results?limit=1',
  ]);
});

test('canonical and alias create commands add correlation and idempotency headers', async () => {
  const observed = [];
  const client = new DashboardApiClient({
    fetchImpl: async (url, options) => {
      observed.push({ url, options });
      return jsonResponse({ id: 'job-1', duplicate: false }, 202);
    },
  });

  const payload = { seedUrls: ['https://example.com/'] };
  const command = { correlationId: 'correlation-1', idempotencyKey: 'idempotency-1' };
  await client.createJob(payload, command);
  await client.createJobCommand(payload, command);

  assert.deepEqual(observed.map((item) => item.url), ['/api/v2/jobs', '/api/v2/commands/crawl']);
  for (const item of observed) {
    assert.equal(item.options.method, 'POST');
    assert.equal(item.options.headers.get('x-correlation-id'), 'correlation-1');
    assert.equal(item.options.headers.get('idempotency-key'), 'idempotency-1');
    assert.deepEqual(JSON.parse(item.options.body), payload);
  }
});

test('canonical and alias cancellation and retry commands use exact paths', async () => {
  const paths = [];
  const client = new DashboardApiClient({
    fetchImpl: async (url, options) => {
      paths.push({ url, method: options.method, correlation: options.headers.get('x-correlation-id') });
      return jsonResponse({ id: 'job-1' });
    },
  });
  const command = { correlationId: 'correlation-2' };
  await client.cancelJob('job-1', command);
  await client.cancelJobCommand('job-1', command);
  await client.retryJob('job-1', command);
  await client.retryJobCommand('job-1', command);
  assert.deepEqual(paths, [
    { url: '/api/v2/jobs/job-1/cancel', method: 'POST', correlation: 'correlation-2' },
    { url: '/api/v2/commands/jobs/job-1/cancel', method: 'POST', correlation: 'correlation-2' },
    { url: '/api/v2/jobs/job-1/retry', method: 'POST', correlation: 'correlation-2' },
    { url: '/api/v2/commands/jobs/job-1/retry', method: 'POST', correlation: 'correlation-2' },
  ]);
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

test('API path traversal is rejected before fetch', async () => {
  const client = new DashboardApiClient({ fetchImpl: async () => jsonResponse({}) });
  await assert.rejects(client.request('api/v2/jobs'), /must start with/);
});
