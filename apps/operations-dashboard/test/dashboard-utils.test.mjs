import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterJobs,
  filterResults,
  mergeById,
  normalizeCapabilities,
  normalizeHealthStatus,
  normalizeStats,
  parseCrawlPayload,
  parseImportText,
  resultsToCsv,
} from '../dashboard-utils.js';

test('health, capabilities, and nested stats normalize to stable dashboard keys', () => {
  assert.equal(normalizeHealthStatus({ status: 'ok' }), 'healthy');
  assert.equal(normalizeHealthStatus({ status: 'ready' }, 'readiness'), 'ready');

  const capabilities = normalizeCapabilities({
    version: '2.0',
    external_delivery_enabled: true,
    registry_enrichment_enabled: false,
    durable_inbound_commands: true,
    max_companies_per_job: 5_000,
    max_pages_per_job: 9_000,
  });
  assert.equal(capabilities.crawl_job_api, true);
  assert.equal(capabilities.outbound_middleware_delivery, true);
  assert.equal(capabilities.registry_enrichment, false);
  assert.equal(capabilities.n8n_reverse_command_inbox, true);
  assert.equal(capabilities.max_companies_per_job, 5_000);

  const stats = normalizeStats(
    {
      jobs: { queued: 2, running: 3, completed: 7, failed: 1 },
      business_entities: 42,
      outbox: { pending: 4, dead_letter: 2 },
    },
    [],
  );
  assert.equal(stats.jobs_total, 13);
  assert.equal(stats.jobs_active, 5);
  assert.equal(stats.jobs_completed_today, 7);
  assert.equal(stats.businesses_total, 42);
  assert.equal(stats.outbox_pending, 4);
  assert.equal(stats.outbox_dead_letter, 2);
});

test('CSV and JSON imports normalize URLs, remove duplicates, and preserve invalid rows', () => {
  const csv = parseImportText(
    'business_name,website\nExample,example.com\nDuplicate,https://example.com/\nBad,ftp://bad.example\n',
    { format: 'csv', maxCompanies: 500 },
  );
  assert.deepEqual(csv.urls, ['https://example.com/']);
  assert.equal(csv.duplicates, 1);
  assert.equal(csv.invalid.length, 1);

  const json = parseImportText(
    JSON.stringify({ companies: [{ url: 'https://one.example/' }, { homepage: 'two.example' }] }),
    { format: 'json', maxCompanies: 500 },
  );
  assert.deepEqual(json.urls, ['https://one.example/', 'https://two.example/']);
});

test('CSV parser supports quoted commas and escaped quotes', () => {
  const parsed = parseImportText(
    'name,website,notes\n"Example, Inc.",https://example.com/,"A ""quoted"" note"\n',
    { format: 'csv' },
  );
  assert.deepEqual(parsed.urls, ['https://example.com/']);
  assert.equal(parsed.invalid.length, 0);
});

test('crawl payload includes documented optional fields and enforces the 500-company dashboard cap', () => {
  const form = new FormData();
  form.set('seedUrls', 'example.com\nhttps://two.example/');
  form.set('profile', 'full');
  form.set('mode', 'domain');
  form.set('browser', 'auto');
  form.set('maxPages', '250');
  form.set('maxCompanies', '3');
  form.set('maxDepth', '3');
  form.set('requestsPerSecond', '1');
  form.set('countryCode', 'do');
  form.set('callbackReference', 'campaign-1');
  form.set('includePatterns', '/about\n/contact');
  form.set('excludePatterns', '/privacy');
  form.set('tags', 'campaign=Q3\nsource=dashboard');

  const payload = parseCrawlPayload(form, {
    capabilities: { max_companies_per_job: 5_000, max_pages_per_job: 50_000 },
    importUrls: ['https://three.example/'],
  });
  assert.deepEqual(payload.seedUrls, [
    'https://example.com/',
    'https://two.example/',
    'https://three.example/',
  ]);
  assert.equal(payload.countryCode, 'DO');
  assert.deepEqual(payload.includePatterns, ['/about', '/contact']);
  assert.deepEqual(payload.excludePatterns, ['/privacy']);
  assert.deepEqual(payload.tags, { campaign: 'Q3', source: 'dashboard' });
  assert.equal(payload.callbackReference, 'campaign-1');

  form.set('maxCompanies', '501');
  assert.throws(
    () => parseCrawlPayload(form, { capabilities: { max_companies_per_job: 5_000 } }),
    /between 1 and 500/,
  );
});

test('unavailable registry and discovery modes fail closed', () => {
  const form = new FormData();
  form.set('seedUrls', 'https://example.com/');
  form.set('profile', 'registry');
  form.set('mode', 'domain');
  form.set('browser', 'auto');
  form.set('maxPages', '10');
  form.set('maxCompanies', '1');
  form.set('maxDepth', '1');
  form.set('requestsPerSecond', '1');
  form.set('countryCode', 'US');
  assert.throws(() => parseCrawlPayload(form, { capabilities: {} }), /Registry enrichment/);
  form.set('profile', 'full');
  form.set('mode', 'discovery');
  assert.throws(() => parseCrawlPayload(form, { capabilities: {} }), /Search discovery/);
});

test('job and result filters cover search, status, sort, confidence, and contacts', () => {
  const jobs = [
    {
      id: '2',
      status: 'failed',
      updated_at: '2026-01-02T00:00:00Z',
      payload: { seedUrls: ['https://beta.example/'] },
    },
    {
      id: '1',
      status: 'completed',
      updated_at: '2026-01-03T00:00:00Z',
      payload: { seedUrls: ['https://alpha.example/'] },
    },
  ];
  assert.deepEqual(
    filterJobs(jobs, { search: 'alpha', status: 'completed', sort: 'updated-desc' }).map(
      (item) => item.id,
    ),
    ['1'],
  );
  assert.deepEqual(
    filterJobs(jobs, { sort: 'status' }).map((item) => item.status),
    ['completed', 'failed'],
  );

  const results = [
    {
      id: 'a',
      record: {
        displayName: 'Alpha',
        confidence: 0.9,
        emails: ['a@example.com'],
        phones: [],
        categories: [],
      },
    },
    {
      id: 'b',
      record: { displayName: 'Beta', confidence: 0.6, emails: [], phones: ['+1'], categories: [] },
    },
  ];
  assert.deepEqual(
    filterResults(results, { search: 'alpha', minConfidence: 0.8, contact: 'email' }).map(
      (item) => item.id,
    ),
    ['a'],
  );
  assert.deepEqual(
    filterResults(results, { contact: 'phone' }).map((item) => item.id),
    ['b'],
  );
});

test('merge and CSV export are deterministic and safe for commas', () => {
  assert.deepEqual(
    mergeById([{ id: '1', value: 'old' }], [{ id: '1', value: 'new' }, { id: '2' }]),
    [{ id: '1', value: 'new' }, { id: '2' }],
  );
  const csv = resultsToCsv([
    {
      id: '1',
      record: {
        displayName: 'Example, Inc.',
        legalName: 'Example LLC',
        domain: 'example.com',
        emails: ['hello@example.com'],
        phones: [],
        addresses: [],
        categories: ['Services'],
      },
    },
  ]);
  assert.match(csv, /"Example, Inc\."/);
  assert.match(csv, /hello@example\.com/);
});
