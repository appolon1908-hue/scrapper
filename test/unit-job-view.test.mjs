import assert from 'node:assert/strict';
import test from 'node:test';
import { jobView } from '../dist/api/support/job-view.js';

test('job view exposes safe request summary and masks internal and verification fields', () => {
  const now = new Date('2026-08-26T00:00:00.000Z');
  const view = jobView({
    id: '90b8ea6f-3b1f-4fb8-bac9-9f44818fb156',
    tenant_id: 'tenant-1',
    requested_by: 'client-1',
    correlation_id: 'correlation-1',
    idempotency_key: 'secret-idempotency-value',
    status: 'failed',
    payload: {
      seedUrls: ['https://example.com'],
      profile: 'full',
      tags: { campaign: 'test' },
      verification: {
        knownEin: '12-3456789',
        provider: 'provider',
        consentReference: 'consent-1',
      },
    },
    progress: { pagesProcessed: 3 },
    error_code: 'crawl_failed',
    error_message: 'failed',
    cancellation_requested: false,
    worker_id: 'worker-1',
    run_token: 'run-token',
    heartbeat_at: now,
    lease_expires_at: now,
    version: 4,
    created_at: now,
    updated_at: now,
    started_at: now,
    completed_at: now,
  });
  assert.equal(view.version, 4);
  assert.deepEqual(view.error, { code: 'crawl_failed', message: 'failed' });
  assert.deepEqual(view.payload, {
    seedUrls: ['https://example.com'],
    profile: 'full',
    tags: { campaign: 'test' },
  });
  assert.equal('verification' in view.payload, false);
  assert.equal('idempotency_key' in view, false);
  assert.equal('requested_by' in view, false);
  assert.equal('worker_id' in view, false);
  assert.equal('run_token' in view, false);
});
