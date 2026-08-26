import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

const secret = 'integration-delivery-hmac-secret';
const accepted = new Set();
const sideEffects = new Map();
let verifiedRequests = 0;

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');

  const { verifySignature } = await import('../dist/security/signature.js');
  const valid = verifySignature(secret, String(request.headers['x-scrapper-signature'] || ''), {
    method: request.method || 'POST',
    path: request.url || '/',
    timestamp: String(request.headers['x-scrapper-timestamp'] || ''),
    eventId: String(request.headers['x-scrapper-event-id'] || ''),
    source: String(request.headers['x-source-system'] || ''),
    tenantId: String(request.headers['x-tenant-id'] || ''),
    idempotencyKey: String(request.headers['idempotency-key'] || ''),
    scopes: String(request.headers['x-scrapper-scopes'] || '')
      .split(' ')
      .filter(Boolean),
    body,
  });
  if (!valid) {
    response.writeHead(401).end('invalid signature');
    return;
  }
  verifiedRequests += 1;

  const key = String(request.headers['idempotency-key']);
  const duplicate = accepted.has(key);
  if (!duplicate) {
    accepted.add(key);
    sideEffects.set(request.url, (sideEffects.get(request.url) || 0) + 1);
  }
  response.writeHead(duplicate ? 200 : 202, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ duplicate }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind');

process.env.NODE_ENV = 'test';
process.env.ENABLE_EXTERNAL_DELIVERY = 'true';
process.env.MIDDLEWARE_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.OUTBOUND_ALLOWED_HOSTS = '127.0.0.1';
process.env.OUTBOUND_HMAC_SECRET = secret;
process.env.OUTBOUND_BEARER_TOKEN = 'integration-bearer-token';
process.env.EIN_FINGERPRINT_PEPPER = 'integration-test-pepper';

const { deliverOutboxEvent } = await import('../dist/delivery/outbox.js');
const { pool } = await import('../dist/persistence/db.js');

function event(overrides) {
  return {
    id: overrides.id,
    tenant_id: 'tenant-integration',
    aggregate_type: 'crawl_job',
    aggregate_id: '00000000-0000-4000-8000-000000000001',
    event_type: overrides.eventType,
    destination_path: overrides.path,
    payload: {
      event_id: overrides.id,
      event_type: overrides.eventType,
      tenant_id: 'tenant-integration',
      correlation_id: 'integration-correlation',
    },
    idempotency_key: overrides.idempotencyKey,
    attempts: 0,
    locked_at: null,
    locked_by: null,
    lock_token: null,
  };
}

test('signed n8n/Odoo projection contract deduplicates replayed deliveries', async (t) => {
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => undefined);
  });

  const n8n = event({
    id: '00000000-0000-4000-8000-000000000010',
    eventType: 'scraper.job.completed',
    path: '/mock/n8n',
    idempotencyKey: 'n8n:job:completed:1',
  });
  const odoo = event({
    id: '00000000-0000-4000-8000-000000000020',
    eventType: 'scraper.business.batch.ready',
    path: '/mock/odoo',
    idempotencyKey: 'odoo:business:batch:1',
  });

  await deliverOutboxEvent(n8n);
  await deliverOutboxEvent(n8n);
  await deliverOutboxEvent(odoo);
  await deliverOutboxEvent(odoo);

  assert.equal(verifiedRequests, 4);
  assert.equal(sideEffects.get('/mock/n8n'), 1);
  assert.equal(sideEffects.get('/mock/odoo'), 1);
});
