import type { CrawlJobRequest } from '../domain/schemas.js';
import { log } from '../log.js';
import { Repository, type JobRecord } from '../persistence/repository.js';
import { enqueueCrawlJob } from '../queues.js';

export type CommandContext = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

export class JobCommandService {
  constructor(private readonly repository: Repository) {}

  async create(
    context: CommandContext,
    idempotencyKey: string,
    payload: CrawlJobRequest,
  ): Promise<{ job: JobRecord; duplicate: boolean }> {
    const created = await this.repository.createJob({
      tenantId: context.tenantId,
      requestedBy: context.actorId,
      correlationId: context.correlationId,
      idempotencyKey,
      payload,
    });
    if (!created.duplicate && created.job.status === 'queued') {
      await this.enqueueReliably(created.job.id, 'crawl_queue_enqueue_deferred');
    }
    return created;
  }

  async cancel(context: CommandContext, jobId: string): Promise<JobRecord | null> {
    return this.repository.requestCancellation(
      context.tenantId,
      context.actorId,
      context.correlationId,
      jobId,
    );
  }

  async retry(context: CommandContext, jobId: string): Promise<JobRecord | null> {
    const job = await this.repository.retryJob(
      context.tenantId,
      context.actorId,
      context.correlationId,
      jobId,
    );
    if (job) await this.enqueueReliably(job.id, 'crawl_retry_enqueue_deferred');
    return job;
  }

  private async enqueueReliably(jobId: string, event: string): Promise<void> {
    try {
      await enqueueCrawlJob(jobId);
    } catch (error) {
      log('warn', event, {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
