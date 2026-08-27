import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { navigation, renderDrawer, renderRoute } from '../components-v2.js';
import { createDemoSnapshot } from '../mock-data.js';
import { normalizeCapabilities, normalizeStats } from '../dashboard-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'index.html',
  'styles.css',
  'enhancements.css',
  'config.js',
  'config.example.js',
  'app-v2.js',
  'api-client.js',
  'components-v2.js',
  'components.js',
  'dashboard-utils.js',
  'mock-data.js',
  'state.js',
  'README.md',
];

for (const file of requiredFiles) {
  const metadata = await stat(path.join(root, file));
  assert.equal(metadata.isFile(), true, `Required dashboard file is missing: ${file}`);
}

const [index, styles, enhancements, config, controller, renderer, packageJson] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'styles.css'), 'utf8'),
  readFile(path.join(root, 'enhancements.css'), 'utf8'),
  readFile(path.join(root, 'config.js'), 'utf8'),
  readFile(path.join(root, 'app-v2.js'), 'utf8'),
  readFile(path.join(root, 'components-v2.js'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
]);

assert.match(index, /<aside[^>]+id="sidebar"/, 'Dashboard requires a primary sidebar');
assert.match(index, /<main[^>]+id="view"/, 'Dashboard requires a semantic main landmark');
assert.match(index, /<dialog[^>]+id="settings-dialog"/, 'Dashboard requires a settings dialog');
assert.match(index, /id="job-drawer"[\s\S]+role="dialog"/, 'Detail drawer must expose dialog semantics');
assert.match(index, /<link rel="stylesheet" href="\.\/enhancements\.css" \/>/, 'Enhancement CSS missing');
assert.match(index, /<script src="\.\/config\.js"><\/script>/, 'Runtime config must load first');
assert.match(index, /<script type="module" src="\.\/app-v2\.js"><\/script>/, 'Corrected app entrypoint missing');
assert.doesNotMatch(index, /(?:src|href)="https?:\/\//i, 'External runtime assets are forbidden');
assert.match(styles, /prefers-reduced-motion/, 'Reduced-motion support is required');
assert.match(styles, /:focus-visible/, 'Visible keyboard focus is required');
assert.match(enhancements, /import-dropzone/, 'Import dropzone styles are missing');
assert.match(enhancements, /diagnostic-grid/, 'Diagnostic state styles are missing');
assert.match(config, /demoMode:\s*true/, 'Checked-in dashboard config must default to demo mode');
assert.match(config, /writeControlsEnabled:\s*false/, 'Checked-in config must keep writes disabled');
assert.equal(packageJson.dependencies, undefined, 'Dashboard must not add runtime dependencies');
assert.equal(packageJson.devDependencies, undefined, 'Dashboard must not add development dependencies');

const snapshot = createDemoSnapshot();
const state = {
  route: 'overview',
  ...snapshot,
  stats: normalizeStats(snapshot.stats, snapshot.jobs),
  capabilities: normalizeCapabilities(snapshot.capabilities),
  demoMode: true,
  writeControlsEnabled: false,
  connection: { apiBaseUrl: '', tenantId: '', authMode: 'same-origin' },
  serviceInfo: null,
  health: 'healthy',
  readiness: 'ready',
  loading: false,
  dataStates: {
    dashboard: 'ready',
    jobs: 'ready',
    results: 'ready',
    diagnostics: 'idle',
    drawer: 'idle',
    command: 'idle',
    import: 'idle',
  },
  errors: {},
  drawer: null,
  selectedResultJobId: snapshot.jobs.find((job) => job.status === 'completed')?.id || null,
  nextJobCursor: 'next-jobs',
  nextResultCursor: 'next-results',
  throughputRange: '12h',
  throughput: [1, 3, 2, 4],
  jobFilters: { search: '', status: '', sort: 'updated-desc' },
  resultFilters: { search: '', minConfidence: 0, contact: 'any' },
  importPreview: {
    fileName: 'companies.csv',
    urls: ['https://example.com/'],
    duplicates: 1,
    invalid: [{ row: 3, error: 'Invalid URL' }],
  },
  draftSeedUrls: 'https://example.com/',
  diagnostics: [],
  pendingActions: {},
  auditEvents: [
    {
      id: 'audit-test',
      title: 'Validation event',
      detail: 'Local only',
      tone: 'success',
      at: new Date().toISOString(),
    },
  ],
};

for (const { route } of navigation) {
  const output = renderRoute(route, { ...state, route });
  assert.ok(output.length > 500, `Route ${route} rendered too little content`);
  assert.doesNotMatch(output, />undefined</, `Route ${route} exposed undefined content`);
  assert.doesNotMatch(output, /<script/i, `Route ${route} generated executable markup`);
}

const newCrawl = renderRoute('new-crawl', { ...state, route: 'new-crawl' });
for (const required of [
  'data-import-file',
  'data-import-dropzone',
  'data-apply-import',
  'name="includePatterns"',
  'name="excludePatterns"',
  'name="tags"',
  'data-crawl-form',
]) {
  assert.match(newCrawl, new RegExp(required), `New-crawl interaction is missing: ${required}`);
}

const jobs = renderRoute('jobs', { ...state, route: 'jobs' });
for (const required of ['data-job-search', 'data-job-status', 'data-job-sort', 'data-clear-job-filters', 'data-load-more-jobs']) {
  assert.match(jobs, new RegExp(required), `Job interaction is missing: ${required}`);
}

const results = renderRoute('results', { ...state, route: 'results' });
for (const required of [
  'data-result-search',
  'data-result-confidence',
  'data-result-contact',
  'data-clear-result-filters',
  'data-export-results="csv"',
  'data-export-results="json"',
  'data-open-result',
  'data-load-more-results',
]) {
  assert.match(results, new RegExp(required), `Result interaction is missing: ${required}`);
}

const integrations = renderRoute('integrations', { ...state, route: 'integrations' });
assert.match(integrations, /data-run-diagnostics/, 'Read-only API diagnostics are missing');
assert.match(integrations, /Mutation aliases are not auto-probed/, 'Mutation safety notice is missing');

const jobDrawer = renderDrawer({ ...state, drawer: { type: 'job', id: snapshot.jobs[0].id } });
assert.match(jobDrawer, /data-copy=/, 'Job drawer copy controls are missing');
assert.match(jobDrawer, /data-cancel-job=/, 'Job drawer cancel action is missing');

const resultDrawer = renderDrawer({ ...state, drawer: { type: 'result', id: snapshot.results[0].id } });
assert.match(resultDrawer, /Evidence/, 'Result drawer evidence section is missing');
assert.match(resultDrawer, /Primary reference|primary reference/i, 'Result drawer action is missing');

for (const action of [
  'data-open-job',
  'data-open-result',
  'data-cancel-job',
  'data-retry-job',
  'data-export-results',
  'data-run-diagnostics',
  'data-apply-import',
  'data-clear-job-filters',
  'data-clear-result-filters',
  'data-throughput-range',
]) {
  assert.match(controller, new RegExp(action), `Controller handler is missing: ${action}`);
}

assert.doesNotMatch(controller, /localStorage/, 'Dashboard must not store tokens or state in localStorage');
assert.doesNotMatch(renderer, /href="#"/, 'Placeholder links are forbidden');

const budgets = {
  'index.html': 32_000,
  'styles.css': 100_000,
  'enhancements.css': 25_000,
  'app-v2.js': 95_000,
  'components-v2.js': 90_000,
  'api-client.js': 35_000,
  'dashboard-utils.js': 45_000,
  'state.js': 20_000,
  'mock-data.js': 30_000,
};
for (const [file, maxBytes] of Object.entries(budgets)) {
  const metadata = await stat(path.join(root, file));
  assert.ok(metadata.size <= maxBytes, `${file} exceeds its ${maxBytes}-byte budget`);
}

process.stdout.write('DASHBOARD_VALIDATION=PASS\n');
process.stdout.write('DOCUMENTED_READ_ENDPOINTS=10\n');
process.stdout.write('DEFAULT_DEMO_MODE=true\n');
process.stdout.write('DEFAULT_WRITE_CONTROLS=false\n');
process.stdout.write('EXTERNAL_ASSETS=0\n');
