import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { navigation, renderJobDrawer, renderRoute } from '../components.js';
import { createDemoSnapshot } from '../mock-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'index.html',
  'styles.css',
  'config.js',
  'config.example.js',
  'app.js',
  'api-client.js',
  'components.js',
  'mock-data.js',
  'state.js',
  'README.md',
];

for (const file of requiredFiles) {
  const metadata = await stat(path.join(root, file));
  assert.equal(metadata.isFile(), true, `Required dashboard file is missing: ${file}`);
}

const [index, styles, config, packageJson] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'styles.css'), 'utf8'),
  readFile(path.join(root, 'config.js'), 'utf8'),
  readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
]);

assert.match(index, /<aside[^>]+id="sidebar"/, 'Dashboard requires a primary sidebar');
assert.match(index, /<main[^>]+id="view"/, 'Dashboard requires a semantic main landmark');
assert.match(index, /<dialog[^>]+id="settings-dialog"/, 'Dashboard requires a settings dialog');
assert.match(index, /<script src="\.\/config\.js"><\/script>/, 'Runtime config must load first');
assert.match(index, /<script type="module" src="\.\/app\.js"><\/script>/, 'App entrypoint missing');
assert.doesNotMatch(index, /(?:src|href)="https?:\/\//i, 'External runtime assets are forbidden');
assert.match(styles, /prefers-reduced-motion/, 'Reduced-motion support is required');
assert.match(styles, /:focus-visible/, 'Visible keyboard focus is required');
assert.match(config, /demoMode:\s*true/, 'Checked-in dashboard config must default to demo mode');
assert.match(
  config,
  /writeControlsEnabled:\s*false/,
  'Checked-in dashboard config must keep writes disabled',
);
assert.equal(packageJson.dependencies, undefined, 'Dashboard must not add runtime dependencies');
assert.equal(
  packageJson.devDependencies,
  undefined,
  'Dashboard must not add development dependencies',
);

const snapshot = createDemoSnapshot();
const state = {
  route: 'overview',
  ...snapshot,
  demoMode: true,
  writeControlsEnabled: false,
  connection: { apiBaseUrl: '', tenantId: '', authMode: 'same-origin' },
  health: 'healthy',
  readiness: 'ready',
  selectedJobId: null,
  selectedResultJobId: snapshot.jobs.find((job) => job.status === 'completed')?.id || null,
  nextJobCursor: null,
  throughput: null,
  jobFilters: { search: '', status: '' },
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

const drawer = renderJobDrawer(snapshot.jobs[0], state);
assert.match(drawer, /Job ID/, 'Job drawer must expose the command identity');
assert.match(drawer, /Write|Cancel|View results|Cancellation/, 'Job drawer actions are missing');

const budgets = {
  'index.html': 30_000,
  'styles.css': 100_000,
  'app.js': 70_000,
  'components.js': 80_000,
  'api-client.js': 30_000,
  'state.js': 20_000,
  'mock-data.js': 30_000,
};
for (const [file, maxBytes] of Object.entries(budgets)) {
  const metadata = await stat(path.join(root, file));
  assert.ok(metadata.size <= maxBytes, `${file} exceeds its ${maxBytes}-byte budget`);
}

process.stdout.write('DASHBOARD_VALIDATION=PASS\n');
process.stdout.write('DEFAULT_DEMO_MODE=true\n');
process.stdout.write('DEFAULT_WRITE_CONTROLS=false\n');
process.stdout.write('EXTERNAL_ASSETS=0\n');
