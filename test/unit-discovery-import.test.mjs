import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsvSeedRows } from '../dist/discovery/csv-adapter.js';
import {
  buildDiscoveryQuery,
  importDiscoveryResults,
  parseAndValidateSeedImport,
  parseJsonSeedRows,
  validateSeedRecords,
} from '../dist/discovery/seed-import.js';

test('CSV aliases, quotes, and tag columns become validated seeds', () => {
  const result = parseAndValidateSeedImport({
    format: 'csv',
    content:
      'Company,URL,Business Email,Telephone,Country,Tag Segment\n"Acme, Inc",acme.example,sales@ACME.example,+1 (212) 555-0100,us,priority',
    maxCompanies: 10,
  });

  assert.equal(result.summary.accepted, 1);
  assert.equal(result.summary.rejected, 0);
  assert.equal(result.companies[0].businessName, 'Acme, Inc');
  assert.equal(result.companies[0].website, 'https://acme.example/');
  assert.equal(result.companies[0].knownEmail, 'sales@acme.example');
  assert.equal(result.companies[0].knownPhone, '+12125550100');
  assert.deepEqual(result.companies[0].tags, { segment: 'priority' });
  assert.match(result.summary.digest, /^[a-f0-9]{64}$/);
});

test('JSON wrapper normalizes URLs and reports invalid and duplicate rows', () => {
  const rows = parseJsonSeedRows({
    companies: [
      { website: 'https://Example.com/path/?utm_source=test', country_code: 'bo' },
      { website: 'example.com/other' },
      { website: 'https://bad.example', email: 'not-an-email' },
    ],
  });
  const result = validateSeedRecords(rows, { maxCompanies: 10 });

  assert.equal(result.summary.accepted, 1);
  assert.equal(result.companies[0].website, 'https://example.com/path');
  assert.equal(result.companies[0].countryCode, 'BO');
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['duplicate_domain', 'invalid_email'],
  );
});

test('CSV import rejects missing website, duplicate headers, and unclosed quotes', () => {
  assert.throws(() => parseCsvSeedRows('name,email\nAcme,a@example.com'), {
    message: 'import_website_column_required',
  });
  assert.throws(() => parseCsvSeedRows('url,website\na.example,a.example'), {
    message: 'csv_duplicate_header',
  });
  assert.throws(() => parseCsvSeedRows('website\n"example.com'), {
    message: 'csv_unclosed_quote',
  });
});

test('JSON import rejects malformed JSON and missing company arrays', () => {
  assert.throws(() => parseJsonSeedRows('{'), { message: 'invalid_json_import' });
  assert.throws(() => parseJsonSeedRows({ result: [] }), {
    message: 'json_companies_array_required',
  });
});

test('validation enforces bounds and URL safety', () => {
  assert.throws(() => validateSeedRecords([], { maxCompanies: 1 }), {
    message: 'companies_required',
  });
  assert.throws(
    () =>
      validateSeedRecords([{ website: 'a.example' }, { website: 'b.example' }], {
        maxCompanies: 1,
      }),
    { message: 'company_limit_exceeded' },
  );
  const result = validateSeedRecords([
    { website: 'https://user:password@example.com' },
    { website: 'https://example.net:8443' },
  ]);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['website_credentials_forbidden', 'website_port_forbidden'],
  );
});

test('discovery result import keeps official domains and removes blocked or duplicate hosts', () => {
  const result = importDiscoveryResults({
    provider: 'bing',
    query: 'plumbers',
    countryCode: 'US',
    maxCompanies: 5,
    results: [
      {
        title: 'Acme Plumbing | Home',
        url: 'https://www.acme.example/contact?q=1',
        snippet: 'One',
      },
      { title: 'Acme duplicate', url: 'https://acme.example/about', snippet: 'Two' },
      { title: 'Social listing', url: 'https://linkedin.com/company/acme', snippet: 'Three' },
      { title: 'Beta — Directory', url: 'https://beta.example/path', snippet: 'Four' },
    ],
  });

  assert.equal(result.rawResultCount, 4);
  assert.equal(result.summary.accepted, 2);
  assert.deepEqual(
    result.companies.map((company) => [company.businessName, company.website]),
    [
      ['Acme Plumbing', 'https://www.acme.example/'],
      ['Beta', 'https://beta.example/'],
    ],
  );
  assert.match(
    buildDiscoveryQuery({ query: 'plumbers', location: 'La Paz' }),
    /-site:linkedin\.com/,
  );
});

test('discovery result import fails when no official candidate remains', () => {
  assert.throws(
    () =>
      importDiscoveryResults({
        provider: 'bing',
        query: 'acme',
        results: [{ title: 'Acme', url: 'https://facebook.com/acme' }],
      }),
    { message: 'companies_required' },
  );
});
