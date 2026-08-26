CREATE TABLE IF NOT EXISTS crawl_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancel_requested','cancelled')),
  payload jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  cancellation_requested boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS crawl_jobs_tenant_created_idx
  ON crawl_jobs (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS crawl_jobs_status_idx
  ON crawl_jobs (status, updated_at);

CREATE TABLE IF NOT EXISTS crawl_pages (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  canonical_url text NOT NULL,
  status_code integer,
  content_hash text NOT NULL,
  page_title text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, source_url, content_hash)
);

CREATE INDEX IF NOT EXISTS crawl_pages_job_idx ON crawl_pages (job_id, id);
CREATE INDEX IF NOT EXISTS crawl_pages_retention_idx ON crawl_pages (captured_at);

CREATE TABLE IF NOT EXISTS business_entities (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entity_key text NOT NULL,
  domain text NOT NULL,
  display_name text NOT NULL,
  record jsonb NOT NULL,
  confidence numeric(5,4) NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_key)
);

CREATE INDEX IF NOT EXISTS business_entities_tenant_domain_idx
  ON business_entities (tenant_id, domain);
CREATE INDEX IF NOT EXISTS business_entities_tenant_name_idx
  ON business_entities (tenant_id, lower(display_name));

CREATE TABLE IF NOT EXISTS job_business_records (
  job_id uuid NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, entity_id)
);

CREATE INDEX IF NOT EXISTS job_business_records_job_idx
  ON job_business_records (job_id, discovered_at, entity_id);

CREATE TABLE IF NOT EXISTS business_identifiers (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  entity_id uuid NOT NULL REFERENCES business_entities(id) ON DELETE CASCADE,
  identifier_type text NOT NULL CHECK (identifier_type IN ('ein')),
  masked_value text,
  fingerprint text,
  verification_status text NOT NULL,
  provider text,
  consent_reference text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_id, identifier_type, fingerprint)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  destination_path text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','delivered','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS outbox_claim_idx
  ON outbox_events (status, available_at, created_at)
  WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_created_idx
  ON audit_events (tenant_id, created_at DESC);
