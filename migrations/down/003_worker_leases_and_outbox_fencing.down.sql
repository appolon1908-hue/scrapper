DROP INDEX IF EXISTS outbox_processing_lease_idx;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS lock_token;

DROP INDEX IF EXISTS crawl_jobs_expired_lease_idx;
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_lease_fields_consistent;
ALTER TABLE crawl_jobs
  DROP COLUMN IF EXISTS heartbeat_at,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS lease_owner;

DELETE FROM schema_migrations
WHERE filename = '003_worker_leases_and_outbox_fencing.sql';
