import crypto from 'node:crypto';
import os from 'node:os';
import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runCrawlJob, type CrawlProgress } from '../crawler/run.js';
import { log } from '../log.js';
import { Repository } from '../persistence/repository.js';
import {
  crawlQueue,
  enqueueCrawlJob,
  redisConnection,
  type CrawlQueuePayload,
} from '../queues.js';

export async function startCrawlWorker(
  repository = new Repository(),
): Promise<() => Promise<void>> {
  const workerId = `${os.hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const worker = new Worker<CrawlQueuePayload, CrawlProgress, 'crawl'>(
    'scrapper-crawl-v2',
    async (job) => runCrawlJob(job, repository, workerId),
    {
      connection: redisConnection,
      concurrency: config.jobConcurrency,
    },
  );

  worker.on('completed', (job) =>
    log('info', 'crawl_job_worker_completed', { queueJobId: job.id }),
  );
  worker.on('failed', (job, error) =>
    log('error', 'crawl_job_worker_failed', {
      queueJobId: job?.id,
      error: error.message,
    }),
  );
  worker.on('error', (error) =>
    log('error', 'crawl_worker_error', { error: error.message }),
  );

  let stopping = false;
  const reconcile = async (): Promise<void> => {
    while (!stopping) {
      try {
        const expired = await repository.requeueExpiredJobRuns(100);
        for (const dispatch of expired) {
          await enqueueCrawlJob(dispatch.id, dispatch.version);
          log('warn', 'expired_crawl_lease_requeued', dispatch);
        }

        const queued = await crawlQueue.getJobs(
          ['waiting', 'active', 'delayed'],
          0,
          500,
          true,
        );
        const queueDispatches = new Set(
          queued.map((job) => `${job.data.jobId}:${job.data.dispatchVersion}`),
        );
        const missing = await repository.listQueuedForReconciliation(100);
        for (const dispatch of missing) {
          const key = `${dispatch.id}:${dispatch.version}`;
          if (!queueDispatches.has(key)) {
            await enqueueCrawlJob(dispatch.id, dispatch.version);
          }
        }
      } catch (error) {
        log('warn', 'queue_reconciliation_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  };
  const reconciliation = reconcile();

  return async () => {
    stopping = true;
    await reconciliation;
    await worker.close();
  };
}
