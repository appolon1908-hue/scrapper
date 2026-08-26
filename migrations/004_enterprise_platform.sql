-- Enterprise ingestion schema; sequenced after the production runtime lease migration.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS enterprise_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('csv', 'json', 'discovery', 'n8n', 'api')),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancel_requested', 'cancelled')
  ),
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_targets integer NOT NULL DEFAULT 0 CHECK (total_targets >= 0 AND total_targets <= 500),
  queued_targets integer NOT NULL DEFAULT 0 CHECK (queued_targets >= 0),
  running_targets integer NOT NULL DEFAULT 0 CHECK (running_targets >= 0),
  completed_targets integer NOT NULL DEFAULT 0 CHECK (completed_targets >= 0),
  failed_targets integer NOT NULL DEFAULT 0 CHECK (failed_targets >= 0),
  suppressed_targets integer NOT NULL DEFAULT 0 CHECK (suppressed_targets >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  job_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
  business_name text,
  website text NOT NULL,
  normalized_domain text NOT NULL,
  known_email text,
  known_phone text,
  known_owner text,
  country_code text NOT NULL DEFAULT 'US' CHECK (country_code ~ '^[A-Z]{2}$'),
  external_reference text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'suppressed', 'cancel_requested', 'cancelled')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  child_job_id uuid,
  result_entity_id uuid,
  lease_token uuid,
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, job_id, ordinal),
  UNIQUE (tenant_id, job_id, normalized_domain),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES enterprise_jobs (tenant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enterprise_discovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  provider text NOT NULL,
  query text NOT NULL,
  location text,
  industry text,
  country_code text NOT NULL DEFAULT 'US' CHECK (country_code ~ '^[A-Z]{2}$'),
  max_companies integer NOT NULL CHECK (max_companies BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  provider_request_id text,
  result_job_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, result_job_id)
    REFERENCES enterprise_jobs (tenant_id, id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS enterprise_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  canonical_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (
    status IN ('pending_review', 'approved', 'rejected', 'merged', 'deleted')
  ),
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  merged_into uuid,
  approved_for_crm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, canonical_key),
  FOREIGN KEY (tenant_id, merged_into)
    REFERENCES enterprise_entities (tenant_id, id)
    ON DELETE SET NULL
);

ALTER TABLE enterprise_targets
  ADD CONSTRAINT enterprise_targets_result_entity_fk
  FOREIGN KEY (tenant_id, result_entity_id)
  REFERENCES enterprise_entities (tenant_id, id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS enterprise_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  entity_id uuid NOT NULL,
  field_type text NOT NULL CHECK (
    field_type IN ('name', 'email', 'phone', 'address', 'owner', 'officer', 'website', 'social', 'category', 'ein')
  ),
  display_value text NOT NULL,
  normalized_value text NOT NULL,
  value_hash text NOT NULL,
  source_url text NOT NULL,
  extractor text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (
    review_status IN ('unreviewed', 'approved', 'rejected', 'moved')
  ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity_id, field_type, value_hash, source_url),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES enterprise_entities (tenant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enterprise_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject', 'merge', 'split', 'edit', 'approve_for_crm')),
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  expected_version bigint NOT NULL,
  before_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES enterprise_entities (tenant_id, id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enterprise_inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  source_system text NOT NULL,
  event_id text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  event_type text NOT NULL,
  body_hash text NOT NULL,
  payload jsonb NOT NULL,
  signature_version text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received' CHECK (
    processing_status IN ('received', 'accepted', 'processed', 'failed', 'dead_letter', 'replayed')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE (tenant_id, source_system, event_id),
  UNIQUE (tenant_id, source_system, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_ein_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  entity_id uuid,
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  provider text NOT NULL,
  masked_ein text NOT NULL,
  ein_fingerprint text NOT NULL,
  legal_name_fingerprint text NOT NULL,
  purpose text NOT NULL,
  consent_reference text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'provider_verified', 'mismatch', 'not_found', 'provider_unavailable', 'manual_review')
  ),
  provider_reference text,
  provider_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES enterprise_entities (tenant_id, id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS enterprise_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  entity_id uuid,
  destination text NOT NULL CHECK (destination IN ('odoo_lead', 'middleware', 'n8n')),
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter', 'cancelled')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 12 CHECK (max_attempts BETWEEN 1 AND 50),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  provider_receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, destination, idempotency_key),
  FOREIGN KEY (tenant_id, entity_id)
    REFERENCES enterprise_entities (tenant_id, id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS enterprise_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  suppression_type text NOT NULL CHECK (
    suppression_type IN ('domain', 'email', 'phone', 'entity', 'person', 'company_reference')
  ),
  value_hash text NOT NULL,
  display_mask text NOT NULL,
  reason text NOT NULL,
  source_reference text,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text,
  revoked_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, suppression_type, value_hash)
);

CREATE TABLE IF NOT EXISTS enterprise_privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('access', 'delete', 'correct', 'restrict')),
  subject_type text NOT NULL CHECK (subject_type IN ('entity', 'email', 'phone', 'domain', 'person')),
  subject_hash text NOT NULL,
  display_mask text NOT NULL,
  legal_basis text NOT NULL,
  requester_reference text NOT NULL,
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'verified', 'processing', 'completed', 'rejected', 'failed')
  ),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS enterprise_retention_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  data_class text NOT NULL CHECK (
    data_class IN ('jobs', 'targets', 'entities', 'observations', 'inbox', 'deliveries', 'audit', 'exports', 'provider_evidence')
  ),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  enabled boolean NOT NULL DEFAULT true,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, data_class)
);

CREATE TABLE IF NOT EXISTS enterprise_auth_states (
  state_hash text PRIMARY KEY,
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS enterprise_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  tenant_id text NOT NULL,
  client_id text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  roles text[] NOT NULL DEFAULT '{}'::text[],
  display_name text,
  email text,
  csrf_hash text NOT NULL,
  encrypted_refresh_token text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS enterprise_audit_events (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  correlation_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'completed', 'rejected', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enterprise_jobs_tenant_status_idx
  ON enterprise_jobs (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS enterprise_targets_claim_idx
  ON enterprise_targets (status, next_attempt_at, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS enterprise_targets_job_status_idx
  ON enterprise_targets (tenant_id, job_id, status, ordinal);
CREATE INDEX IF NOT EXISTS enterprise_discovery_status_idx
  ON enterprise_discovery_requests (status, created_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS enterprise_entities_review_idx
  ON enterprise_entities (tenant_id, status, confidence, updated_at DESC);
CREATE INDEX IF NOT EXISTS enterprise_entities_record_gin_idx
  ON enterprise_entities USING gin (record jsonb_path_ops);
CREATE INDEX IF NOT EXISTS enterprise_observations_entity_idx
  ON enterprise_observations (tenant_id, entity_id, field_type, confidence DESC);
CREATE INDEX IF NOT EXISTS enterprise_inbox_status_idx
  ON enterprise_inbox_messages (processing_status, received_at)
  WHERE processing_status IN ('received', 'accepted', 'failed');
CREATE INDEX IF NOT EXISTS enterprise_deliveries_claim_idx
  ON enterprise_deliveries (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS enterprise_suppressions_lookup_idx
  ON enterprise_suppressions (tenant_id, suppression_type, value_hash)
  WHERE active;
CREATE INDEX IF NOT EXISTS enterprise_privacy_status_idx
  ON enterprise_privacy_requests (status, created_at)
  WHERE status IN ('verified', 'processing');
CREATE INDEX IF NOT EXISTS enterprise_sessions_expiry_idx
  ON enterprise_sessions (expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS enterprise_audit_resource_idx
  ON enterprise_audit_events (tenant_id, resource_type, resource_id, created_at DESC);

COMMIT;
