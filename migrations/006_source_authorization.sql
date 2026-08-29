ALTER TABLE tenant_sources
  ADD COLUMN authorization_basis text NOT NULL DEFAULT 'public_unauthenticated'
    CHECK (authorization_basis IN (
      'public_unauthenticated',
      'tenant_owned_account',
      'contracted_api_or_license',
      'written_permission'
    )),
  ADD COLUMN authorization_reference text,
  ADD COLUMN authorization_recorded_at timestamptz,
  ADD COLUMN authorization_recorded_by text;

CREATE TABLE IF NOT EXISTS domain_policies (
  id uuid PRIMARY KEY,
  domain text UNIQUE NOT NULL,
  robots_posture text NOT NULL CHECK (
    robots_posture IN ('respect','respect_with_exemption')
  ),
  tos_review_status text NOT NULL CHECK (
    tos_review_status IN ('unreviewed','permitted','prohibited','licensed')
  ),
  tos_reference text,
  max_rps numeric NOT NULL DEFAULT 0.5 CHECK (max_rps > 0 AND max_rps <= 100),
  crawl_delay_seconds integer CHECK (crawl_delay_seconds IS NULL OR crawl_delay_seconds >= 0),
  requires_authentication boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (domain = lower(domain)),
  CHECK (domain !~ '[/:@]')
);

CREATE INDEX IF NOT EXISTS domain_policies_enforcement_idx
  ON domain_policies(domain,blocked,tos_review_status);
