-- Stop active workers before rollback. Normalize any remaining leased work so the
-- pre-lease runtime can safely reconcile it after the columns are removed.
UPDATE crawl_jobs
SET status = CASE WHEN cancellation_requested THEN 'cancelled' ELSE 'queued' END,
    completed_at = CASE WHEN cancellation_requested THEN now() ELSE NULL END,
    updated_at = now(),
    version = version + 1
WHERE status IN ('running', 'cancel_requested');

UPDATE outbox_events
SET status = 'pending',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
WHERE status = 'processing';

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
