import type {
  BusinessRecord,
  CrawlJobRequest,
  JobStatus,
} from '../domain/schemas.js';

export type JobRecord = {
  id: string;
  tenant_id: string;
  requested_by: string;
  correlation_id: string;
  idempotency_key: string;
  status: JobStatus;
  payload: CrawlJobRequest;
  progress: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  cancellation_requested: boolean;
  worker_id: string | null;
  run_token: string | null;
  heartbeat_at: Date | null;
  lease_expires_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

export type OutboxEvent = {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  destination_path: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  lock_token: string | null;
};

export type CreateJobInput = {
  tenantId: string;
  requestedBy: string;
  correlationId: string;
  idempotencyKey: string;
  payload: CrawlJobRequest;
};

export type QueuedJobDispatch = {
  id: string;
  version: number;
};

export type BusinessResult = {
  id: string;
  record: BusinessRecord;
};

export type AuditInput = {
  tenantId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};
