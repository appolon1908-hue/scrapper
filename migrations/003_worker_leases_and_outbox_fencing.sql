ALTER TABLE crawl_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

ALTER TABLE crawl_jobs
  ADD CONSTRAINT crawl_jobs_lease_fields_consistent
  CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS crawl_jobs_expired_lease_idx
  ON crawl_jobs (lease_expires_at, updated_at, id)
  WHERE status IN ('running', 'cancel_requested');

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS lock_token uuid;

CREATE INDEX IF NOT EXISTS outbox_processing_lease_idx
  ON outbox_events (locked_at, id)
  WHERE status = 'processing';
