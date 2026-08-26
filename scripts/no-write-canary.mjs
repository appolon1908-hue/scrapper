import crypto from 'node:crypto';

const baseUrl = String(process.env.CANARY_API_BASE || '').replace(/\/$/, '');
const token = String(process.env.CANARY_TOKEN || '');
const tenantId = String(process.env.CANARY_TENANT_ID || '');
const seedUrl = String(process.env.CANARY_SEED_URL || 'https://example.com');
const timeoutSeconds = Number(process.env.CANARY_TIMEOUT_SECONDS || 240);

if (!baseUrl || !token || !tenantId) {
  throw new Error(
    'CANARY_API_BASE, CANARY_TOKEN and CANARY_TENANT_ID are required',
  );
}

const headers = {
  authorization: `Bearer ${token}`,
  'x-tenant-id': tenantId,
  accept: 'application/json',
};

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`canary_http_${response.status}:${JSON.stringify(body)}`);
  }
  return body;
}

function deliveredCount(stats) {
  return Number(stats?.outbox?.delivered || 0);
}

const capabilities = await request('/api/v2/capabilities');
if (capabilities.external_delivery_enabled !== false) {
  throw new Error('canary_refused_external_delivery_enabled');
}
if (capabilities.registry_enrichment_enabled !== false) {
  throw new Error('canary_refused_registry_enrichment_enabled');
}

const beforeStats = await request('/api/v2/stats');
const correlationId = crypto.randomUUID();
const idempotencyKey = `staging-no-write-${crypto.randomUUID()}`;
const job = await request('/api/v2/jobs', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-correlation-id': correlationId,
    'idempotency-key': idempotencyKey,
  },
  body: JSON.stringify({
    seedUrls: [seedUrl],
    profile: 'company',
    mode: 'single',
    browser: 'http',
    maxPages: 1,
    maxCompanies: 1,
    maxDepth: 0,
    requestsPerSecond: 0.5,
    tags: {
      canary: 'no-write',
      release_sha: process.env.RELEASE_SHA || 'unknown',
    },
  }),
});

const deadline = Date.now() + timeoutSeconds * 1000;
let current = job;
while (!['completed', 'failed', 'cancelled'].includes(current.status)) {
  if (Date.now() >= deadline) throw new Error('canary_job_timeout');
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  current = await request(`/api/v2/jobs/${job.id}`);
}

if (current.status !== 'completed') {
  throw new Error(`canary_job_${current.status}:${JSON.stringify(current.error)}`);
}

const results = await request(`/api/v2/jobs/${job.id}/results?limit=10`);
const afterStats = await request('/api/v2/stats');
if (deliveredCount(afterStats) !== deliveredCount(beforeStats)) {
  throw new Error('canary_detected_external_delivery');
}

console.log(
  JSON.stringify(
    {
      canary: 'PASS',
      job_id: job.id,
      correlation_id: correlationId,
      status: current.status,
      result_count: Array.isArray(results.items) ? results.items.length : 0,
      delivered_before: deliveredCount(beforeStats),
      delivered_after: deliveredCount(afterStats),
      external_delivery_enabled: capabilities.external_delivery_enabled,
      registry_enrichment_enabled: capabilities.registry_enrichment_enabled,
    },
    null,
    2,
  ),
);
