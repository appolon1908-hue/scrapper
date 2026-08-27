import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalSignatureInput,
  signRequest,
  verifySignature,
} from '../dist/security/signature.js';

const input = {
  method: 'post',
  path: '/api/v2/results?z=2&a=1',
  timestamp: '1700000000',
  eventId: 'event-1',
  source: 'codestra-scrapper',
  tenantId: 'tenant-1',
  idempotencyKey: 'idem-1',
  scopes: ['scraper.results.write', 'scraper.events.write'],
  body: '{"ok":true}',
};

test('signature canonicalization is deterministic', () => {
  const canonical = canonicalSignatureInput(input);
  assert.match(canonical, /^v2\nPOST\n\/api\/v2\/results\?a=1&z=2\n/);
  assert.equal(
    canonicalSignatureInput({ ...input, scopes: [...input.scopes].reverse() }),
    canonical,
  );
});

test('signature verification rejects changed payloads', () => {
  const signature = signRequest('test-secret', input);
  assert.equal(verifySignature('test-secret', signature, input), true);
  assert.equal(
    verifySignature('test-secret', signature, { ...input, body: '{"ok":false}' }),
    false,
  );
});
