import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const canonicalRepository = 'appolon1908-hue/kyqra-crawler';
const reconciliationManifest = 'docs/evidence/P0/RECONCILIATION_MANIFEST.md';
const sealedBranchEvidence = new Set([
  reconciliationManifest,
  'docs/evidence/P0/BRANCH_TEST_MATRIX.md',
]);

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

test('repository identity consistently selects the canonical Kyqra lineage', () => {
  const decision = read('docs/architecture/CANONICAL_REPOSITORY.md');
  const mission = read('MISSION.md');
  const readme = read('README.md');
  const handoff = read('docs/integrations/n8n/CANONICAL_RUNTIME_HANDOFF.md');
  const runtimeManifest = JSON.parse(read('docs/integrations/n8n/canonical-runtime.v2.json'));
  const integrationManifest = JSON.parse(read('docs/integrations/n8n/manifest.v1.json'));

  for (const [name, content] of [
    ['canonical decision', decision],
    ['mission amendment', mission],
    ['README', readme],
    ['runtime handoff', handoff],
  ]) {
    assert.match(
      content,
      new RegExp(canonicalRepository.replace('/', '\\/')),
      `${name} must name the canonical repository`,
    );
  }

  assert.match(decision, /preserved legacy implementation lineage/);
  assert.match(mission, /must not run here/i);
  assert.match(readme, /preserved legacy Kyqra lineage/);
  assert.equal(runtimeManifest.repository_role, 'LEGACY_CURRENT_LINEAGE_PRESERVED');
  assert.equal(runtimeManifest.canonical_future_repository, canonicalRepository);
  assert.equal(integrationManifest.system, 'kyqra-crawler');
  assert.equal(integrationManifest.base_branch, 'main');
  assert.equal(integrationManifest.branch, 'main');
});

test('active documents do not direct work to a deleted legacy branch', () => {
  const manifest = read(reconciliationManifest);
  const legacyBranches = [...manifest.matchAll(/^## `([^`]+)`$/gm)].map((match) => match[1]);
  assert.equal(
    legacyBranches.length,
    21,
    'the sealed reconciliation inventory must contain 21 branches',
  );

  const activeDocuments = ['README.md', 'MISSION.md', ...walk('docs')].filter(
    (file) =>
      !sealedBranchEvidence.has(file) &&
      (file.endsWith('.md') ||
        file.endsWith('.json') ||
        file.endsWith('.yaml') ||
        file.endsWith('.yml')),
  );

  for (const file of activeDocuments) {
    const content = read(file);
    for (const branch of legacyBranches) {
      assert.ok(
        !content.includes(branch),
        `${file} still directs readers to deleted branch ${branch}`,
      );
    }
  }
});

test('legacy deployment and release-governance workflows fail before privileged work', () => {
  for (const file of [
    '.github/workflows/deploy-staging.yml',
    '.github/workflows/production-deploy.yml',
    '.github/workflows/configure-release-protection.yml',
  ]) {
    const workflow = read(file);
    assert.match(workflow, /authority_gate:/, `${file} must declare the authority gate`);
    assert.match(workflow, /blocked-by-canonical-repository-decision/);
    assert.match(workflow, /exit 1/);
    assert.match(
      workflow,
      /needs: authority_gate/,
      `${file} privileged work must depend on the failing gate`,
    );
    assert.match(workflow, /release\/legacy-lineage-disabled/);
  }
});
