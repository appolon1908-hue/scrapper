-- Normalize any work left in an unfenced state before lease constraints are enabled.
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

ALTER TABLE crawl_jobs
  ADD COLUMN worker_id text,
  ADD COLUMN run_token uuid,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE outbox_events
  ADD COLUMN lock_token uuid;

ALTER TABLE crawl_jobs
  ADD CONSTRAINT crawl_jobs_runtime_lease_state CHECK (
    (
      status IN ('running', 'cancel_requested')
      AND worker_id IS NOT NULL
      AND run_token IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
    OR
    (
      status NOT IN ('running', 'cancel_requested')
      AND worker_id IS NULL
      AND run_token IS NULL
      AND heartbeat_at IS NULL
      AND lease_expires_at IS NULL
    )
  );

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_processing_lock_state CHECK (
    (
      status = 'processing'
      AND locked_at IS NOT NULL
      AND locked_by IS NOT NULL
      AND lock_token IS NOT NULL
    )
    OR
    (
      status <> 'processing'
      AND lock_token IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS crawl_jobs_expired_lease_idx
  ON crawl_jobs (lease_expires_at, id)
  WHERE status IN ('running', 'cancel_requested');

CREATE INDEX IF NOT EXISTS outbox_events_processing_lease_idx
  ON outbox_events (locked_at, id)
  WHERE status = 'processing';
