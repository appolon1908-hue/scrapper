import assert from 'node:assert/strict';
import test from 'node:test';
import { CrawlJobRequestSchema, ResultListQuerySchema } from '../dist/domain/schemas.js';

test('crawl job request applies bounded defaults', () => {
  const parsed = CrawlJobRequestSchema.parse({
    seedUrls: ['https://example.com'],
  });
  assert.equal(parsed.profile, 'full');
  assert.equal(parsed.mode, 'domain');
  assert.equal(parsed.maxCompanies, 500);
  assert.equal(parsed.maxPages, 250);
});

test('crawl job request rejects credentials in a URL', () => {
  const parsed = CrawlJobRequestSchema.safeParse({
    seedUrls: ['https://user:password@example.com'],
  });
  assert.equal(parsed.success, false);
});

test('result cursor must be a UUID', () => {
  assert.equal(ResultListQuerySchema.safeParse({ cursor: 'not-a-uuid' }).success, false);
  assert.equal(
    ResultListQuerySchema.safeParse({
      cursor: '90b8ea6f-3b1f-4fb8-bac9-9f44818fb156',
    }).success,
    true,
  );
});
