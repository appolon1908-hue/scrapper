import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldVisitUrl } from '../dist/security/url-policy.js';

test('domain policy permits reviewed URLs that pass path filters', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/companies/acme', ['/companies/'], ['/private/'], {
      blocked: false,
      tos_review_status: 'permitted',
    }),
    true,
  );
});

test('domain policy fails closed for administratively blocked domains', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/', [], [], {
      blocked: true,
      tos_review_status: 'permitted',
    }),
    false,
  );
});

test('domain policy fails closed when terms prohibit crawling', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/', [], [], {
      blocked: false,
      tos_review_status: 'prohibited',
    }),
    false,
  );
});

test('path exclusions still deny URLs under a licensed domain policy', () => {
  assert.equal(
    shouldVisitUrl('https://example.com/private/report', [], ['/private/'], {
      blocked: false,
      tos_review_status: 'licensed',
    }),
    false,
  );
});
