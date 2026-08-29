CREATE TABLE IF NOT EXISTS discovery_imports (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  source_id uuid,
  requested_by text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  format text NOT NULL CHECK (format IN ('csv','json','xlsx')),
  content_digest text NOT NULL,
  byte_count bigint NOT NULL CHECK (byte_count >= 0),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'validated' CHECK (
    status IN ('validated','queued','processing','completed','completed_with_errors','failed','cancelled')
  ),
  input_count integer NOT NULL DEFAULT 0 CHECK (input_count >= 0),
  accepted_count integer NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,source_id)
    REFERENCES tenant_sources(tenant_id,id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS discovery_seeds (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  import_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100000),
  business_name text,
  website text NOT NULL,
  normalized_domain text NOT NULL,
  known_email text,
  known_phone text,
  known_owner text,
  country_code text NOT NULL DEFAULT 'US' CHECK (country_code ~ '^[A-Z]{2}$'),
  external_reference text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (
    status IN ('ready','queued','processing','completed','failed','suppressed','cancelled')
  ),
  crawl_job_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,import_id,ordinal),
  UNIQUE (tenant_id,import_id,normalized_domain),
  FOREIGN KEY (tenant_id,import_id)
    REFERENCES discovery_imports(tenant_id,id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,crawl_job_id)
    REFERENCES crawl_jobs(tenant_id,id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS discovery_requests (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE CASCADE,
  source_id uuid,
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
    status IN ('queued','running','completed','failed','cancelled')
  ),
  provider_request_id text,
  result_import_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,source_id)
    REFERENCES tenant_sources(tenant_id,id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id,result_import_id)
    REFERENCES discovery_imports(tenant_id,id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS discovery_imports_status_idx
  ON discovery_imports(status,created_at)
  WHERE status IN ('validated','queued','processing');
CREATE INDEX IF NOT EXISTS discovery_seeds_claim_idx
  ON discovery_seeds(status,created_at,ordinal)
  WHERE status IN ('ready','queued');
CREATE INDEX IF NOT EXISTS discovery_seeds_import_idx
  ON discovery_seeds(tenant_id,import_id,status,ordinal);
CREATE INDEX IF NOT EXISTS discovery_requests_status_idx
  ON discovery_requests(status,created_at)
  WHERE status = 'queued';
