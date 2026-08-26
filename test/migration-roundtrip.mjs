import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const { pool, runMigrations } = await import('../dist/persistence/db.js');
const root = process.cwd();

async function execute(relativePath) {
  const sql = await fs.readFile(path.join(root, relativePath), 'utf8');
  await pool.query(sql);
}

async function migrationNames() {
  const result = await pool.query(
    'select filename from schema_migrations order by filename',
  );
  return result.rows.map((row) => row.filename);
}

try {
  await runMigrations();
  await pool.query(`
    truncate table
      audit_events,
      outbox_events,
      business_identifiers,
      job_business_records,
      business_entities,
      crawl_pages,
      crawl_jobs
    restart identity cascade
  `);

  await execute('migrations/down/003_worker_leases_and_outbox_fencing.down.sql');
  const removedLeaseColumns = await pool.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='crawl_jobs'
       and column_name in ('lease_owner','lease_token','lease_expires_at','heartbeat_at')`,
  );
  assert.equal(removedLeaseColumns.rowCount, 0);
  assert.equal(
    (await migrationNames()).includes('003_worker_leases_and_outbox_fencing.sql'),
    false,
  );

  await runMigrations();
  const restoredLeaseColumns = await pool.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='crawl_jobs'
       and column_name in ('lease_owner','lease_token','lease_expires_at','heartbeat_at')`,
  );
  assert.equal(restoredLeaseColumns.rowCount, 4);

  await execute('migrations/down/003_worker_leases_and_outbox_fencing.down.sql');
  await execute('migrations/down/002_tenant_integrity.down.sql');
  const tenantConstraints = await pool.query(
    `select conname from pg_constraint
     where conname in (
       'crawl_jobs_tenant_id_id_unique',
       'business_entities_tenant_id_id_unique',
       'crawl_pages_tenant_job_fk',
       'job_business_records_tenant_job_fk',
       'job_business_records_tenant_entity_fk',
       'business_identifiers_tenant_entity_fk'
     )`,
  );
  assert.equal(tenantConstraints.rowCount, 0);

  await runMigrations();
  assert.deepEqual(await migrationNames(), [
    '001_initial.sql',
    '002_tenant_integrity.sql',
    '003_worker_leases_and_outbox_fencing.sql',
  ]);
  const restoredConstraints = await pool.query(
    `select conname from pg_constraint
     where conname in (
       'crawl_jobs_tenant_id_id_unique',
       'business_entities_tenant_id_id_unique',
       'crawl_pages_tenant_job_fk',
       'job_business_records_tenant_job_fk',
       'job_business_records_tenant_entity_fk',
       'business_identifiers_tenant_entity_fk'
     )`,
  );
  assert.equal(restoredConstraints.rowCount, 6);

  console.log('migration_roundtrip=PASS');
} finally {
  await pool.end();
}
