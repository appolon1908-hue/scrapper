import type {
  BusinessRecord,
  CrawlJobRequest,
  JobListQuery,
  ResultListQuery,
} from '../domain/schemas.js';
import { BusinessRepository, type SavePageInput } from './business-repository.js';
import { DomainPolicyRepository } from './domain-policy-repository.js';
import { JobRepository } from './job-repository.js';
import { LifecycleRepository } from './lifecycle-repository.js';
import { OperationsRepository } from './operations-repository.js';
import { OutboxRepository } from './outbox-repository.js';
import type {
  CreateJobInput,
  DomainPolicy,
  JobRecord,
  OutboxEvent,
  QueuedJobDispatch,
} from './types.js';

export type { CreateJobInput, JobRecord, OutboxEvent, QueuedJobDispatch } from './types.js';

export class Repository {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly businesses = new BusinessRepository(),
    private readonly lifecycle = new LifecycleRepository(),
    private readonly outbox = new OutboxRepository(),
    private readonly operations = new OperationsRepository(),
    private readonly domainPolicies = new DomainPolicyRepository(),
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

  claimJobRun(
    id: string,
    dispatchVersion: number,
    workerId: string,
    runToken: string,
    leaseSeconds: number,
  ): Promise<JobRecord | null> {
    return this.jobs.claimRun(id, dispatchVersion, workerId, runToken, leaseSeconds);
  }

  renewJobLease(
    id: string,
    runToken: string,
    progress: Record<string, unknown>,
    leaseSeconds: number,
  ): Promise<{ cancellationRequested: boolean } | null> {
    return this.jobs.renewLease(id, runToken, progress, leaseSeconds);
  }

  cancellationRequested(id: string, runToken: string): Promise<boolean> {
    return this.jobs.cancellationRequested(id, runToken);
  }

  listQueuedForReconciliation(limit = 100): Promise<QueuedJobDispatch[]> {
    return this.jobs.listQueuedForReconciliation(limit);
  }

  requeueExpiredJobRuns(limit = 100): Promise<QueuedJobDispatch[]> {
    return this.jobs.requeueExpiredRuns(limit);
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

  finalizeJob(id: string, runToken: string, progress: Record<string, unknown>): Promise<void> {
    return this.lifecycle.finalizeJob(id, runToken, progress);
  }

  failJob(id: string, runToken: string, errorCode: string, errorMessage: string): Promise<boolean> {
    return this.lifecycle.failJob(id, runToken, errorCode, errorMessage);
  }

  claimOutbox(workerId: string, lockToken: string, limit = 20): Promise<OutboxEvent[]> {
    return this.outbox.claim(workerId, lockToken, limit);
  }

  markOutboxDelivered(id: string, workerId: string, lockToken: string): Promise<boolean> {
    return this.outbox.markDelivered(id, workerId, lockToken);
  }

  markOutboxFailed(
    id: string,
    workerId: string,
    lockToken: string,
    error: string,
  ): Promise<boolean> {
    return this.outbox.markFailed(id, workerId, lockToken, error);
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

  domainPolicyForHost(hostname: string): Promise<DomainPolicy | null> {
    return this.domainPolicies.getForHost(hostname);
  }
}
