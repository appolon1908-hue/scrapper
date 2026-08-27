CREATE TABLE IF NOT EXISTS platform_tenants (
  tenant_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready_read_only','active','suspended','decommissioned')),
  plan text NOT NULL DEFAULT 'standard',
  quotas jsonb NOT NULL DEFAULT '{"maxConcurrentJobs":2,"maxDailyJobs":100,"maxTargetsPerCommand":500}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tenant_sources (
  id uuid PRIMARY KEY, tenant_id text NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  name text NOT NULL, source_type text NOT NULL CHECK (source_type IN ('website','sitemap','directory','manual_list')),
  seed_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','invalid','archived')),
  validation_status text NOT NULL DEFAULT 'not_checked', validation_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS tenant_schedules (
  id uuid PRIMARY KEY, tenant_id text NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  source_id uuid, name text NOT NULL, cron_expression text NOT NULL, timezone text NOT NULL DEFAULT 'UTC',
  profile text NOT NULL DEFAULT 'full', browser text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused','disabled','error')),
  execution_enabled boolean NOT NULL DEFAULT false, last_run_at timestamptz, next_run_at timestamptz,
  last_error text, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,name), FOREIGN KEY(tenant_id,source_id) REFERENCES tenant_sources(tenant_id,id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tenant_integrations (
  id uuid PRIMARY KEY, tenant_id text NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('middleware','n8n','odoo','webhook','registry')),
  display_name text NOT NULL, endpoint_host text,
  status text NOT NULL DEFAULT 'configured' CHECK (status IN ('configured','healthy','degraded','paused','disabled','unverified')),
  external_writes_enabled boolean NOT NULL DEFAULT false, last_check_at timestamptz, last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,kind,display_name)
);
CREATE TABLE IF NOT EXISTS business_reviews (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, entity_id uuid,
  company_name text NOT NULL, domain text, reason text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence>=0 AND confidence<=1),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','merged','split','reopened')),
  decision_note text, decided_by text, decided_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,entity_id) REFERENCES business_entities(tenant_id,id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS control_inbox_messages (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, message_id text NOT NULL, message_type text NOT NULL,
  source_id text NOT NULL, payload jsonb NOT NULL, payload_digest text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processing','completed','retrying','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), available_at timestamptz NOT NULL DEFAULT now(),
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,message_id)
);
CREATE TABLE IF NOT EXISTS control_dead_letters (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, source_type text NOT NULL, source_id text NOT NULL,
  message_type text NOT NULL, payload jsonb NOT NULL, error_code text NOT NULL, error_message text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','replayed','resolved')),
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count>=0), last_replayed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, resource_type text NOT NULL, format text NOT NULL,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed','expired')),
  object_key text, record_count integer, last_error text, expires_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version>0), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_sources_tenant_idx ON tenant_sources(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_schedules_tenant_idx ON tenant_schedules(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_integrations_tenant_idx ON tenant_integrations(tenant_id,status,kind);
CREATE INDEX IF NOT EXISTS business_reviews_tenant_idx ON business_reviews(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS control_inbox_tenant_idx ON control_inbox_messages(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS control_dead_letters_tenant_idx ON control_dead_letters(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS export_jobs_tenant_idx ON export_jobs(tenant_id,status,created_at DESC);
