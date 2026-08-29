import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const { pool, rollbackLastMigration, runMigrations } = await import('../dist/persistence/db.js');
const expectedMigrations = (await fs.readdir(new URL('../migrations/', import.meta.url)))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();

async function migrationNames() {
  const result = await pool.query('select filename from schema_migrations order by filename');
  return result.rows.map((row) => row.filename);
}

try {
  await runMigrations();
  assert.deepEqual(await migrationNames(), expectedMigrations);

  for (const filename of [...expectedMigrations].reverse()) {
    assert.equal(await rollbackLastMigration(), filename);
  }
  assert.equal(
    (await pool.query(`select to_regclass('public.crawl_jobs') as relation`)).rows[0]?.relation,
    null,
  );

  await runMigrations();
  assert.deepEqual(await migrationNames(), expectedMigrations);
  assert.equal(
    (await pool.query(`select to_regclass('public.domain_policies') as relation`)).rows[0]
      ?.relation,
    'domain_policies',
  );
  console.log('migration_roundtrip=PASS');
} finally {
  await pool.end();
}
