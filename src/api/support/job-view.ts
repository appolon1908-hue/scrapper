import type { JobRecord } from '../../persistence/repository.js';

export function jobView(job: JobRecord): Record<string, unknown> {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    correlation_id: job.correlation_id,
    status: job.status,
    progress: job.progress,
    error: job.error_code
      ? { code: job.error_code, message: job.error_message }
      : null,
    version: job.version,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}
