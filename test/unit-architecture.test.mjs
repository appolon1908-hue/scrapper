import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

function lines(path) {
  return fs.readFileSync(path, 'utf8').split('\n').length;
}

test('composition roots remain small', () => {
  assert.ok(lines('src/api/app.ts') <= 60, 'src/api/app.ts must remain a small composition root');
  assert.ok(
    lines('src/persistence/repository.ts') <= 180,
    'src/persistence/repository.ts must remain a small facade',
  );
});

test('large responsibilities are split into focused modules', () => {
  for (const path of [
    'src/api/routes/jobs.ts',
    'src/api/routes/operations.ts',
    'src/persistence/job-repository.ts',
    'src/persistence/business-repository.ts',
    'src/persistence/lifecycle-repository.ts',
    'src/persistence/outbox-repository.ts',
  ]) {
    assert.ok(fs.existsSync(path), `${path} is required`);
    assert.ok(lines(path) <= 260, `${path} should stay focused`);
  }
});
