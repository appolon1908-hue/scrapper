import type {
  CrawlJobRequest,
  JobListQuery,
  ResultListQuery,
  BusinessRecord,
} from '../domain/schemas.js';
import { BusinessRepository, type SavePageInput } from './business-repository.js';
import { JobRepository } from './job-repository.js';
import { LifecycleRepository } from './lifecycle-repository.js';
import { OperationsRepository } from './operations-repository.js';
import { OutboxRepository } from './outbox-repository.js';
import type { CreateJobInput, JobRecord, OutboxEvent } from './types.js';

export type { CreateJobInput, JobRecord, OutboxEvent } from './types.js';

export class Repository {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly businesses = new BusinessRepository(),
    private readonly lifecycle = new LifecycleRepository(),
    private readonly outbox = new OutboxRepository(),
    private readonly operations = new OperationsRepository(),
  ) {}

  createJob(input: CreateJobInput): Promise<{ job: JobRecord; duplicate: boolean }> {
    return this.jobs.create(input);
  }

  getJob(tenantId: string, id: string): Promise<JobRecord | null> {
    return this.jobs.get(tenantId, id);
  }

  getJobForWorker(id: string): Promise<JobRecord | null> {
    return this.jobs.getForWorker(id);
  }

  listJobs(
    tenantId: string,
    query: JobListQuery,
  ): Promise<{ items: JobRecord[]; nextCursor: string | null }> {
    return this.jobs.list(tenantId, query);
  }

  requestCancellation(
    tenantId: string,
    actorId: string,
    correlationId: string,
    id: string,
  ): Promise<JobRecord | null> {
    return this.jobs.requestCancellation(tenantId, actorId, correlationId, id);
  }

  retryJob(
    tenantId: string,
    actorId: string,
    correlationId: string,
    id: string,
  ): Promise<JobRecord | null> {
    return this.jobs.retry(tenantId, actorId, correlationId, id);
  }

  markRunning(id: string): Promise<boolean> {
    return this.jobs.markRunning(id);
  }

  updateProgress(id: string, progress: Record<string, unknown>): Promise<void> {
    return this.jobs.updateProgress(id, progress);
  }

  cancellationRequested(id: string): Promise<boolean> {
    return this.jobs.cancellationRequested(id);
  }

  listQueuedForReconciliation(limit = 100): Promise<string[]> {
    return this.jobs.listQueuedForReconciliation(limit);
  }

  savePage(input: SavePageInput): Promise<void> {
    return this.businesses.savePage(input);
  }

  upsertBusiness(
    tenantId: string,
    jobId: string,
    record: BusinessRecord,
    verification?: CrawlJobRequest['verification'],
  ): Promise<string> {
    return this.businesses.upsert(tenantId, jobId, record, verification);
  }

  getResults(
    tenantId: string,
    jobId: string,
    query: ResultListQuery,
  ): Promise<{
    items: Array<{ id: string; record: BusinessRecord }>;
    nextCursor: string | null;
  }> {
    return this.businesses.listForJob(tenantId, jobId, query);
  }

  finalizeJob(id: string, progress: Record<string, unknown>): Promise<void> {
    return this.lifecycle.finalizeJob(id, progress);
  }

  failJob(id: string, errorCode: string, errorMessage: string): Promise<void> {
    return this.lifecycle.failJob(id, errorCode, errorMessage);
  }

  claimOutbox(workerId: string, limit = 20): Promise<OutboxEvent[]> {
    return this.outbox.claim(workerId, limit);
  }

  markOutboxDelivered(id: string): Promise<void> {
    return this.outbox.markDelivered(id);
  }

  markOutboxFailed(id: string, error: string): Promise<void> {
    return this.outbox.markFailed(id, error);
  }

  releaseStaleOutboxLocks(): Promise<number> {
    return this.outbox.releaseStaleLocks();
  }

  stats(tenantId: string): Promise<Record<string, unknown>> {
    return this.operations.stats(tenantId);
  }

  retentionSweep(): Promise<{ pages: number; jobs: number }> {
    return this.operations.retentionSweep();
  }
}
