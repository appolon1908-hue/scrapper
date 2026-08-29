import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const productionKong = fs.readFileSync('deploy/kong/kong.yml', 'utf8');
const validationKong = fs.readFileSync('deploy/gateway/kong.yml', 'utf8');
const validationCaddy = fs.readFileSync('deploy/gateway/Caddyfile', 'utf8');
const gatewayValidation = fs.readFileSync('scripts/validate-gateway.sh', 'utf8');

test('production Kong exposes the implemented platform-admin and service-info routes', () => {
  assert.match(productionKong, /^      - name: codestra-scrapper-platform-admin$/m);
  assert.match(productionKong, /^          - \/platform\/v2$/m);
  assert.match(productionKong, /^      - name: codestra-scrapper-service-info$/m);
  assert.match(productionKong, /^          - '~\^\/\$'$/m);
  assert.match(productionKong, /^        methods: \[GET\]$/m);
});

test('production Kong does not advertise an unimplemented webhook route', () => {
  assert.doesNotMatch(productionKong, /\/api\/v2\/webhooks/);
});

test('gateway validation covers the corrected route surface and production config', () => {
  for (const path of ['/platform/v2', '/healthz', '/readyz', '/openapi.yaml']) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(validationKong, new RegExp(`^          - ${escapedPath}$`, 'm'));
  }

  assert.match(validationKong, /^          - '~\^\/\$'$/m);
  assert.match(validationCaddy, /@scrapper_api path .* \/platform\/v2 \/platform\/v2\/\*/);
  assert.match(gatewayValidation, /kong config parse \/kong\/production\.kong\.yml/);
  assert.match(gatewayValidation, /https:\/\/localhost:8443\/platform\/v2\/tenants/);
  assert.match(gatewayValidation, /https:\/\/localhost:8443\/\)"$/m);
});
