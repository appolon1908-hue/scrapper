DROP TABLE IF EXISTS domain_policies;

ALTER TABLE tenant_sources
  DROP COLUMN IF EXISTS authorization_recorded_by,
  DROP COLUMN IF EXISTS authorization_recorded_at,
  DROP COLUMN IF EXISTS authorization_reference,
  DROP COLUMN IF EXISTS authorization_basis;
