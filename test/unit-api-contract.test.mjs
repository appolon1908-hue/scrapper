import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const contract = fs.readFileSync('openapi/openapi.yaml', 'utf8');
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
];

test('OpenAPI contract declares every implemented route', () => {
  assert.match(contract, /^openapi: 3\.1\.0/m);
  for (const path of implementedPaths) {
    assert.match(contract, new RegExp(`^  ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:$`, 'm'));
  }
});

test('OpenAPI contract does not claim production is live', () => {
  assert.match(contract, /not claim that the service has been deployed to production/i);
});
