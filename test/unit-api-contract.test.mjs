import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contract = fs.readFileSync('openapi/openapi.yaml', 'utf8');
const operationsSource = fs.readFileSync('src/api/routes/operations.ts', 'utf8');
const implementedPaths = [
  '/',
  '/healthz',
  '/readyz',
  '/openapi.yaml',
  '/api/v2/jobs',
  '/api/v2/commands/crawl',
  '/api/v2/jobs/{id}',
  '/api/v2/jobs/{id}/results',
  '/api/v2/jobs/{id}/cancel',
  '/api/v2/commands/jobs/{id}/cancel',
  '/api/v2/jobs/{id}/retry',
  '/api/v2/commands/jobs/{id}/retry',
  '/api/v2/stats',
  '/api/v2/metrics',
  '/api/v2/capabilities',
  '/platform/v2/tenants',
  '/platform/v2/tenants/{tenantId}',
  '/platform/v2/tenants/{tenantId}/summary',
  '/api/v2/sources',
  '/api/v2/schedules',
  '/api/v2/integrations',
  '/api/v2/businesses',
  '/api/v2/businesses/{id}/evidence',
  '/api/v2/reviews',
  '/api/v2/outbox',
  '/api/v2/inbox',
  '/api/v2/dead-letters',
  '/api/v2/exports',
  '/api/v2/audit-events',
  '/api/v2/control-plane/summary',
];

test('OpenAPI contract declares every implemented route', () => {
  assert.match(contract, /^openapi: 3\.1\.0/m);
  for (const path of implementedPaths) {
    assert.match(contract, new RegExp(`^  ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:$`, 'm'));
  }
});

test('OpenAPI documents the safe job payload and stable dashboard capability names', () => {
  assert.match(contract, /^    CrawlJobPublicRequest:$/m);
  assert.match(
    contract,
    /^        payload:\n          \$ref: '#\/components\/schemas\/CrawlJobPublicRequest'$/m,
  );
  assert.match(contract, /^    Capabilities:$/m);
  for (const field of [
    'crawl_job_api',
    'http_crawler',
    'playwright_crawler',
    'outbound_middleware_delivery',
    'registry_enrichment',
    'n8n_reverse_command_inbox',
    'odoo_crm_projection',
    'authoritative_ein_provider',
    'keycloak_human_login',
    'runtime_paths_verified',
    'production_deployed',
  ]) {
    assert.match(contract, new RegExp(`^        ${field}:`, 'm'));
    assert.match(operationsSource, new RegExp(`\\b${field}:`));
  }
});

test('public job response schema excludes sensitive verification input', () => {
  const start = contract.indexOf('    CrawlJobPublicRequest:');
  const end = contract.indexOf('\n    Job:', start);
  assert.ok(start >= 0 && end > start);
  const publicSchema = contract.slice(start, end);
  assert.doesNotMatch(publicSchema, /knownEin|consentReference|verification:/);
});

test('OpenAPI contract does not claim production is live', () => {
  assert.match(contract, /not claim that the service has been deployed to production/i);
});
