import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifestPath = path.resolve('docs/evidence/P0/RECONCILIATION_MANIFEST.md');
const mode = process.argv[2];

const legacyBranches = [
  [
    'backup/enterprise-ingestion-before-sync-20260826T151534Z',
    '25c17d56a19f17b24eedad4a5660c97bc2c874a3',
  ],
  ['docs/stage0-deployment-truth-20260829', '9a970784adff4697b7782d0e7f41153be16901d6'],
  ['feature/business-intelligence-pipeline', '6f0d824cad6266f99006378f9f81f87bafba321a'],
  ['feature/enterprise-control-plane-v3-20260826', '88f2ca1232ec14ccd47331ff207b82b95b94b15a'],
  [
    'feature/enterprise-ingestion-discovery-v2-20260826',
    '0708edcf14d57c6c999e53559b00d6145ebb6ae9',
  ],
  [
    'feature/enterprise-ingestion-discovery-v2b-20260826',
    '25c17d56a19f17b24eedad4a5660c97bc2c874a3',
  ],
  ['feature/enterprise-platform-foundation-20260826', '549fde1b14dedf8d45c901a3847d1047eb521836'],
  ['feature/enterprise-platform-v2-20260826', 'a96b622648825dcc5585385d0a140a3291be0f1b'],
  ['feature/operations-dashboard', 'd17a4c3eeef06cb49ba49e6d435762b6a96ad636'],
  ['feature/operations-dashboard-production-v2', 'ebb35fe01bdab04d8b81956dbdb05419b089ff28'],
  ['feature/turnkey-control-plane-api-v1', '8580361c4b8ba293b89fb1470b17c0f3a4087346'],
  ['feature/turnkey-control-plane-dashboard-v1', '75fc233e113eff95b288df98a25c136efcf86c8c'],
  ['feature/turnkey-kong-control-plane-v1', 'e3a769b5cbce95909c0d8c3af57b1dca68f6d0b2'],
  ['hardening/runtime-path-deployment-gates', 'aec0f259b0b526b359938d42744c54f3c83561ce'],
  ['hardening/security-observability', '6f0d824cad6266f99006378f9f81f87bafba321a'],
  ['integration/kong-caddy-odoo-n8n', '6f0d824cad6266f99006378f9f81f87bafba321a'],
  ['integration/n8n-crawler-automation-v2-20260827', 'ce0454778b5822a0b2dd80890ecf86db0da03203'],
  ['ops/codex-docker-deployment', '649d41a47953db281f7fed74285b103243f6d3cc'],
  ['refactor/modular-production-core', '70a99ca9ea29041fa1d5cbab965dc0e400723ba0'],
  ['release/production-readiness-20260826', '4de79fed63f30390d5d5be184fb468cce4df8a24'],
  ['security/enterprise-keycloak-n8n-ein-v2-20260826', 'df89f8ea09f8b166122b6afd4e4f3612bbb0fda7'],
];

const rewrites = new Map([
  [
    'enterprise/csv-json.mjs',
    {
      target: 'src/discovery/csv-adapter.ts',
      reason:
        'CSV/JSON parsing was rewritten as typed, Zod-validated TypeScript with dedicated unit coverage.',
    },
  ],
  [
    'enterprise/discovery.mjs',
    {
      target: 'src/discovery/seed-import.ts',
      reason:
        'Discovery and seed normalization were rewritten as typed, policy-aware TypeScript with dedicated unit coverage.',
    },
  ],
]);

const absentDropReasons = new Map([
  [
    '.github/workflows/apply-production-readiness.yml',
    'Dropped self-modifying bundle-application workflow; reviewed source now moves through the normal protected PR and immutable-image workflows.',
  ],
  [
    '.github/workflows/export-source.yml',
    'Dropped short-retention source snapshot workflow; the reviewed turnkey worktree export workflow is retained instead.',
  ],
  [
    '.release-bundle/part-000',
    'Dropped generated, embedded release bundle; generated archives are not canonical source and are rebuilt from reviewed commits.',
  ],
  [
    'docs/enterprise/STACK.md',
    'Dropped lineage-specific planning note after its dependency sequence and fail-closed intent were incorporated into the mission and canonical architecture documents.',
  ],
  [
    'docs/enterprise/SECURITY_CONTROL_PLANE.md',
    'Dropped lineage-specific security document after the Keycloak realm/client design was extracted into docs/architecture/IDENTITY.md.',
  ],
  [
    'enterprise/config.mjs',
    'Dropped duplicate Lineage B configuration root; the canonical implementation remains src/config.ts with default-closed flags.',
  ],
  [
    'enterprise/queues.mjs',
    'Dropped the second, incompatible BullMQ topology; the canonical queue implementation remains src/queues.ts.',
  ],
  [
    'enterprise/storage.mjs',
    'Dropped duplicate Lineage B persistence and audit stack; canonical typed repositories remain under src/persistence/.',
  ],
  [
    'enterprise/target-worker.mjs',
    'Dropped duplicate enterprise worker/crawl orchestration; canonical workers and crawler remain under src/workers/ and src/crawler/.',
  ],
  [
    'migrations/003_enterprise_platform.sql',
    'Dropped colliding enterprise schema revision; reviewed discovery tables were renumbered and ported into migrations/005_discovery.sql.',
  ],
  [
    'migrations/004_enterprise_platform.sql',
    'Dropped colliding enterprise schema revision; reviewed discovery and authorization schema was ported into migrations/005_discovery.sql and migrations/006_source_authorization.sql.',
  ],
  [
    'migrations/down/004_enterprise_platform.down.sql',
    'Dropped the colliding down migration; canonical rollback is provided by migrations/down/005_discovery.down.sql and migrations/down/006_source_authorization.down.sql.',
  ],
  [
    '.github/workflows/deploy-staging-v2.yml',
    'Dropped superseded staging workflow revision; .github/workflows/deploy-staging.yml retains immutable-image and write-disabled staging controls.',
  ],
  [
    'migrations/003_worker_leases_and_outbox_fencing.sql',
    'Dropped duplicate migration number; equivalent lease and fencing schema is canonical in migrations/003_runtime_leases.sql.',
  ],
  [
    'migrations/down/003_worker_leases_and_outbox_fencing.down.sql',
    'Dropped duplicate-number down migration; canonical rollback is migrations/down/003_runtime_leases.down.sql.',
  ],
  [
    'test/integration-postgres-redis.test.mjs',
    'Dropped superseded integration fixture; PostgreSQL/Redis behavior is covered by test/integration-runtime.test.mjs and migration rollback by test/migration-roundtrip.mjs.',
  ],
]);

const normalizedPortPaths = new Set([
  '.github/workflows/export-turnkey-worktree.yml',
  'docs/CODEX_DOCKER_DEPLOYMENT_TASK.md',
  'docs/architecture/TURNKEY_KONG_SCRAPER_PLATFORM.md',
  'docs/integrations/n8n/CANONICAL_RUNTIME_HANDOFF.md',
  'docs/integrations/n8n/README.md',
  'docs/integrations/n8n/canonical-runtime.v2.json',
  'docs/integrations/n8n/manifest.v1.json',
]);

const divergentBranchReasons = new Map([
  [
    'feature/enterprise-control-plane-v3-20260826',
    'Reviewed branch-specific runtime lease, fencing, queue, and CI changes. The target retains later canonical implementations at the same paths, and its current PostgreSQL/Redis integration suite passes 8/8; this older parallel revision is retired.',
  ],
  [
    'feature/enterprise-ingestion-discovery-v2-20260826',
    'Reviewed shared enterprise-bundle edits to canonical API, gateway, policy, persistence, and test files. The target retains later canonical revisions at the same paths; the genuinely unique discovery files are separately dispositioned as rewrites or explicit drops.',
  ],
  [
    'security/enterprise-keycloak-n8n-ein-v2-20260826',
    'Reviewed shared enterprise-bundle edits to canonical API, gateway, policy, persistence, and test files. The target retains later canonical revisions at the same paths; the genuinely unique identity and enterprise-stack files are separately dispositioned.',
  ],
]);

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: options.encoding,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: [
      options.input === undefined ? 'ignore' : 'pipe',
      'pipe',
      options.ignoreError ? 'ignore' : 'pipe',
    ],
  });
}

function treeAt(commit) {
  const output = git(['ls-tree', '-rz', '--full-tree', commit]);
  const tree = new Map();
  for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    const metadata = record.slice(0, separator).split(' ');
    const file = record.slice(separator + 1);
    if (metadata[1] !== 'blob') throw new Error(`unexpected_tree_entry:${commit}:${file}`);
    tree.set(file, metadata[2]);
  }
  return tree;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashObjects(objectIds) {
  const output = git(['cat-file', '--batch'], {
    input: `${objectIds.join('\n')}\n`,
  });
  const hashes = new Map();
  let offset = 0;

  for (const expectedOid of objectIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) {
      throw new Error(
        `cat_file_header_missing:${expectedOid}:offset=${offset}:output=${output.length}`,
      );
    }
    const [actualOid, type, sizeText] = output
      .subarray(offset, headerEnd)
      .toString('utf8')
      .split(' ');
    const size = Number(sizeText);
    if (actualOid !== expectedOid || type !== 'blob' || !Number.isSafeInteger(size)) {
      throw new Error(`cat_file_header_invalid:${expectedOid}`);
    }
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    hashes.set(expectedOid, sha256(output.subarray(bodyStart, bodyEnd)));
    offset = bodyEnd + 1;
  }

  return hashes;
}

function safeField(value) {
  return String(value).replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

function buildManifest(targetCommit) {
  const trees = new Map([[targetCommit, treeAt(targetCommit)]]);
  const branchDeltaPaths = new Map();
  const allObjectIds = new Set(trees.get(targetCommit).values());

  for (const [branch, expectedTip] of legacyBranches) {
    const actualTip = git(['rev-parse', `origin/${branch}`], { encoding: 'utf8' }).trim();
    if (actualTip !== expectedTip) {
      throw new Error(`branch_tip_changed:${branch}:${expectedTip}:${actualTip}`);
    }
    if (!trees.has(expectedTip)) trees.set(expectedTip, treeAt(expectedTip));
    for (const objectId of trees.get(expectedTip).values()) allObjectIds.add(objectId);
    const mergeBase = git(['merge-base', expectedTip, targetCommit], { encoding: 'utf8' }).trim();
    const delta = git(['diff', '--name-only', '-z', mergeBase, expectedTip]);
    branchDeltaPaths.set(branch, new Set(delta.toString('utf8').split('\0').filter(Boolean)));
  }

  const hashByObjectId = hashObjects([...allObjectIds]);
  const targetTree = trees.get(targetCommit);
  const targetByHash = new Map();
  for (const [file, objectId] of targetTree) {
    const hash = hashByObjectId.get(objectId);
    const paths = targetByHash.get(hash) ?? [];
    paths.push(file);
    targetByHash.set(hash, paths);
  }

  const lines = [
    '# Phase 0 content-reconciliation manifest',
    '',
    '**Generated:** 2026-08-29  ',
    `**Reconciliation target:** \`${targetCommit}\`  `,
    `**Legacy branches:** ${legacyBranches.length}  `,
    '**Allowed dispositions:** `ported-identical`, `ported-rewritten`, `intentionally-dropped`',
    '',
    'Every tracked file from every recorded branch tip is listed below. SHA-256 values are',
    'computed from Git blob content, not from a checked-out working tree. Exact duplicate branch',
    'tips remain separate sections. Generation fails on any absent path without an explicit',
    'rewrite or reviewed drop reason.',
    '',
  ];

  const totals = {
    files: 0,
    identical: 0,
    rewritten: 0,
    dropped: 0,
  };

  for (const [branch, expectedTip] of legacyBranches) {
    const branchTree = trees.get(expectedTip);
    const branchFiles = [...branchTree.keys()].sort();
    lines.push(
      `## \`${branch}\``,
      '',
      `**Tip:** \`${expectedTip}\`  `,
      `**Files:** ${branchFiles.length}`,
      '',
    );
    lines.push('```tsv', 'file\tdisposition\tsource_sha256\ttarget_or_reason');

    for (const file of branchFiles) {
      const sourceHash = hashByObjectId.get(branchTree.get(file));
      let disposition;
      let detail;

      if (targetTree.has(file)) {
        const targetHash = hashByObjectId.get(targetTree.get(file));
        if (sourceHash === targetHash) {
          disposition = 'ported-identical';
          detail = `target=${file}; target_sha256=${targetHash}`;
          totals.identical += 1;
        } else if (normalizedPortPaths.has(file)) {
          disposition = 'intentionally-dropped';
          detail = `source revision retired after formatting/normalization; canonical target=${file}; target_sha256=${targetHash}`;
          totals.dropped += 1;
        } else if (file === 'README.md') {
          disposition = 'intentionally-dropped';
          detail = `source revision superseded by reconciled deployment-truth README; target_sha256=${targetHash}`;
          totals.dropped += 1;
        } else if (branchDeltaPaths.get(branch).has(file)) {
          const reason = divergentBranchReasons.get(branch);
          if (!reason) throw new Error(`unreviewed_divergent_file:${branch}:${file}`);
          disposition = 'intentionally-dropped';
          detail = `${reason} target_sha256=${targetHash}`;
          totals.dropped += 1;
        } else {
          disposition = 'intentionally-dropped';
          detail = `older branch revision superseded by the canonical Phase 0 file at the same path; target_sha256=${targetHash}`;
          totals.dropped += 1;
        }
      } else if (rewrites.has(file)) {
        const rewrite = rewrites.get(file);
        if (!rewrite.target.startsWith('src/') || !targetTree.has(rewrite.target)) {
          throw new Error(`invalid_rewrite_target:${file}:${rewrite.target}`);
        }
        const targetHash = hashByObjectId.get(targetTree.get(rewrite.target));
        disposition = 'ported-rewritten';
        detail = `target=${rewrite.target}; target_sha256=${targetHash}; ${rewrite.reason}`;
        totals.rewritten += 1;
      } else if (targetByHash.has(sourceHash)) {
        const targetPath = targetByHash.get(sourceHash)[0];
        disposition = 'ported-identical';
        detail = `target=${targetPath}; target_sha256=${sourceHash}`;
        totals.identical += 1;
      } else if (absentDropReasons.has(file)) {
        disposition = 'intentionally-dropped';
        detail = absentDropReasons.get(file);
        totals.dropped += 1;
      } else {
        throw new Error(`undispositioned_file:${branch}:${file}`);
      }

      totals.files += 1;
      lines.push([safeField(file), disposition, sourceHash, safeField(detail)].join('\t'));
    }

    lines.push('```', '');
  }

  lines.push(
    '## Totals',
    '',
    `- Branches: ${legacyBranches.length}`,
    `- File dispositions: ${totals.files}`,
    `- Ported identical: ${totals.identical}`,
    `- Ported rewritten: ${totals.rewritten}`,
    `- Intentionally dropped: ${totals.dropped}`,
    '- Missing dispositions: 0',
    '',
    'Branch deletion is allowed only while each remote tip still equals the SHA recorded above.',
    '',
  );

  return lines.join('\n');
}

if (!['write', 'verify'].includes(mode)) {
  throw new Error('usage: node scripts/reconciliation-manifest.mjs <write|verify> [target]');
}

if (mode === 'write') {
  const target = process.argv[3];
  if (!target) throw new Error('write mode requires an immutable target commit');
  const targetCommit = git(['rev-parse', target], { encoding: 'utf8' }).trim();
  fs.writeFileSync(manifestPath, buildManifest(targetCommit), 'utf8');
  console.log(`reconciliation_manifest_written:${manifestPath}`);
} else {
  const existing = fs.readFileSync(manifestPath, 'utf8');
  const match = existing.match(/^\*\*Reconciliation target:\*\* `([a-f0-9]{40})`/m);
  if (!match) throw new Error('manifest_target_missing');
  const expected = buildManifest(match[1]);
  if (existing !== expected) throw new Error('reconciliation_manifest_out_of_date');
  console.log(`reconciliation_manifest_verified:branches=${legacyBranches.length}`);
}
