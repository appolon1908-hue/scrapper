ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_processing_lock_state;
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_runtime_lease_state;
DROP INDEX IF EXISTS outbox_events_processing_lease_idx;
DROP INDEX IF EXISTS crawl_jobs_expired_lease_idx;
ALTER TABLE outbox_events DROP COLUMN IF EXISTS lock_token;
ALTER TABLE crawl_jobs
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS heartbeat_at,
  DROP COLUMN IF EXISTS run_token,
  DROP COLUMN IF EXISTS worker_id;
