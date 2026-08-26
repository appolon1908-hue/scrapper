ALTER TABLE crawl_jobs
  ADD CONSTRAINT crawl_jobs_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE business_entities
  ADD CONSTRAINT business_entities_tenant_id_id_unique UNIQUE (tenant_id, id);

ALTER TABLE crawl_pages
  ADD CONSTRAINT crawl_pages_tenant_job_fk
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES crawl_jobs (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE job_business_records
  ADD CONSTRAINT job_business_records_tenant_job_fk
  FOREIGN KEY (tenant_id, job_id)
  REFERENCES crawl_jobs (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE job_business_records
  ADD CONSTRAINT job_business_records_tenant_entity_fk
  FOREIGN KEY (tenant_id, entity_id)
  REFERENCES business_entities (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE business_identifiers
  ADD CONSTRAINT business_identifiers_tenant_entity_fk
  FOREIGN KEY (tenant_id, entity_id)
  REFERENCES business_entities (tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE business_entities
  ADD CONSTRAINT business_entities_confidence_range
  CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE job_business_records
  ADD CONSTRAINT job_business_records_confidence_range
  CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_attempts_nonnegative
  CHECK (attempts >= 0);

CREATE INDEX IF NOT EXISTS business_entities_record_gin_idx
  ON business_entities USING gin (record jsonb_path_ops);

CREATE INDEX IF NOT EXISTS audit_events_resource_idx
  ON audit_events (tenant_id, resource_type, resource_id, created_at DESC);
