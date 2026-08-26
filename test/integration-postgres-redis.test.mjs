import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';

const { pool, runMigrations } = await import('../dist/persistence/db.js');
const { Repository } = await import('../dist/persistence/repository.js');
const { CrawlJobRequestSchema } = await import('../dist/domain/schemas.js');
const {
  closeQueues,
  crawlQueue,
  enqueueCrawlJob,
  pingRedis,
} = await import('../dist/queues.js');

const repository = new Repository();
const payload = CrawlJobRequestSchema.parse({
  seedUrls: ['https://example.com'],
  maxPages: 1,
  maxCompanies: 1,
  browser: 'http',
});

async function resetRuntimeTables() {
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
  await crawlQueue.drain(true);
}

async function createJob(suffix) {
  return repository.createJob({
    tenantId: 'tenant-a',
    requestedBy: 'integration-test',
    correlationId: `correlation-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    payload,
  });
}

before(async () => {
  await runMigrations();
  await pingRedis();
  await resetRuntimeTables();
});

after(async () => {
  await crawlQueue.drain(true).catch(() => undefined);
  await closeQueues();
  await pool.end();
});

test('real PostgreSQL and Redis dependencies are available', async () => {
  const database = await pool.query('select current_database() as name');
  assert.equal(database.rows[0].name, 'scrapper');
  await pingRedis();

  const migrations = await pool.query(
    'select filename from schema_migrations order by filename',
  );
  assert.deepEqual(
    migrations.rows.map((row) => row.filename),
    [
      '001_initial.sql',
      '002_tenant_integrity.sql',
      '003_worker_leases_and_outbox_fencing.sql',
    ],
  );
});

test('job idempotency and tenant foreign keys fail closed', async () => {
  await resetRuntimeTables();
  const first = await createJob('idempotency');
  const duplicate = await repository.createJob({
    tenantId: 'tenant-a',
    requestedBy: 'integration-test',
    correlationId: 'correlation-idempotency',
    idempotencyKey: 'idempotency-idempotency',
    payload,
  });

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.job.id, first.job.id);

  await assert.rejects(
    pool.query(
      `insert into crawl_pages(
         tenant_id,job_id,source_url,canonical_url,content_hash,page_title,metadata
       ) values($1,$2,$3,$4,$5,$6,$7)`,
      [
        'tenant-b',
        first.job.id,
        'https://example.com',
        'https://example.com/',
        'content-hash',
        'Example',
        {},
      ],
    ),
    (error) => error?.code === '23503',
  );
});

test('expired crawl leases are recovered and stale workers are fenced', async () => {
  await resetRuntimeTables();
  const created = await createJob('lease');
  const firstToken = await repository.markRunning(created.job.id, 'worker-a');
  assert.ok(firstToken);
  assert.equal(await repository.heartbeatJob(created.job.id, firstToken), true);
  assert.equal(
    await repository.updateProgress(created.job.id, firstToken, { pagesProcessed: 1 }),
    true,
  );

  await pool.query(
    `update crawl_jobs
     set lease_expires_at=now()-interval '1 second'
     where id=$1`,
    [created.job.id],
  );

  const recovered = await repository.recoverExpiredJobLeases(10);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, created.job.id);
  assert.equal(
    await repository.updateProgress(created.job.id, firstToken, { stale: true }),
    false,
  );

  const secondToken = await repository.markRunning(created.job.id, 'worker-b');
  assert.ok(secondToken);
  assert.notEqual(secondToken, firstToken);
  assert.equal(
    await repository.finalizeJob(created.job.id, secondToken, { completed: true }),
    true,
  );
  assert.equal(
    await repository.finalizeJob(created.job.id, firstToken, { stale: true }),
    false,
  );

  const stored = await repository.getJob('tenant-a', created.job.id);
  assert.equal(stored.status, 'completed');
  assert.equal(stored.lease_token, null);
});

test('BullMQ dispatch is deterministic for one database job version', async () => {
  await resetRuntimeTables();
  const created = await createJob('queue');
  const firstId = await enqueueCrawlJob(created.job.id, created.job.version);
  const secondId = await enqueueCrawlJob(created.job.id, created.job.version);

  assert.equal(firstId, secondId);
  assert.equal(firstId, `crawl-${created.job.id}-${created.job.version}`);
  const queued = await crawlQueue.getJob(firstId);
  assert.ok(queued);
  assert.equal(queued.data.jobId, created.job.id);
  assert.equal(queued.data.dispatchVersion, created.job.version);
  await queued.remove();
});

test('outbox acknowledgements are fenced to the active claim token', async () => {
  await resetRuntimeTables();
  const eventId = crypto.randomUUID();
  await pool.query(
    `insert into outbox_events(
       id,tenant_id,aggregate_type,aggregate_id,event_type,
       destination_path,payload,idempotency_key
     ) values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      eventId,
      'tenant-a',
      'crawl_job',
      crypto.randomUUID(),
      'scraper.job.completed',
      '/api/v2/scraper/jobs/events',
      { event_id: eventId, correlation_id: 'outbox-test' },
      `event:${eventId}`,
    ],
  );

  const firstClaim = await repository.claimOutbox('worker-a', 1);
  assert.equal(firstClaim.length, 1);
  assert.ok(firstClaim[0].lock_token);

  await pool.query(
    `update outbox_events set locked_at=now()-interval '20 minutes' where id=$1`,
    [eventId],
  );
  assert.equal(await repository.releaseStaleOutboxLocks(), 1);

  const secondClaim = await repository.claimOutbox('worker-b', 1);
  assert.equal(secondClaim.length, 1);
  assert.ok(secondClaim[0].lock_token);
  assert.notEqual(secondClaim[0].lock_token, firstClaim[0].lock_token);

  assert.equal(
    await repository.markOutboxDelivered(
      eventId,
      'worker-a',
      firstClaim[0].lock_token,
    ),
    false,
  );
  assert.equal(
    await repository.markOutboxDelivered(
      eventId,
      'worker-b',
      secondClaim[0].lock_token,
    ),
    true,
  );

  const stored = await pool.query(
    'select status,locked_by,lock_token from outbox_events where id=$1',
    [eventId],
  );
  assert.equal(stored.rows[0].status, 'delivered');
  assert.equal(stored.rows[0].locked_by, null);
  assert.equal(stored.rows[0].lock_token, null);
});
