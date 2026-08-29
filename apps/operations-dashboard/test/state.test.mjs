import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStore,
  escapeHtml,
  getJobTitle,
  progressPercent,
  statusMeta,
  summarizeJobs,
} from '../state.js';

test('job progress uses the strongest bounded signal and never reports 100 before completion', () => {
  const job = {
    status: 'running',
    progress: { pagesProcessed: 75, companiesResolved: 20 },
    payload: { maxPages: 100, maxCompanies: 25 },
  };
  assert.equal(progressPercent(job), 80);
  assert.equal(progressPercent({ ...job, progress: { pagesProcessed: 500 } }), 99);
  assert.equal(progressPercent({ ...job, status: 'completed' }), 100);
  assert.equal(progressPercent({ ...job, status: 'queued' }), 0);
});

test('job summary reports active and terminal success states', () => {
  const summary = summarizeJobs([
    { status: 'queued' },
    { status: 'running' },
    { status: 'cancel_requested' },
    { status: 'completed' },
    { status: 'completed' },
    { status: 'failed' },
  ]);
  assert.equal(summary.total, 6);
  assert.equal(summary.active, 3);
  assert.equal(summary.completed, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.successRate, 67);
});

test('render helpers escape markup and derive safe titles', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(
    getJobTitle({ payload: { seedUrls: ['https://www.codestra.co/path'] } }),
    'codestra.co',
  );
  assert.equal(statusMeta('not-a-state').tone, 'muted');
});

test('store updates immutably and publishes state', () => {
  const store = createStore({ value: 1 });
  const values = [];
  const unsubscribe = store.subscribe((state) => values.push(state.value));
  store.setState((state) => ({ ...state, value: state.value + 1 }));
  unsubscribe();
  store.setState({ value: 3 });
  assert.deepEqual(values, [2]);
  assert.equal(store.getState().value, 3);
});
