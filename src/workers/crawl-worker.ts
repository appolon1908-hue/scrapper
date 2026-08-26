import { Worker } from 'bullmq';
import { config } from '../config.js';
import { runCrawlJob, type CrawlProgress } from '../crawler/run.js';
import { log } from '../log.js';
import { Repository } from '../persistence/repository.js';
import { crawlQueue, enqueueCrawlJob, redisConnection } from '../queues.js';

export async function startCrawlWorker(
  repository = new Repository(),
): Promise<() => Promise<void>> {
  const worker = new Worker<{ jobId: string }, CrawlProgress, 'crawl'>(
    'scrapper-crawl-v2',
    async (job) => runCrawlJob(job, repository),
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
  worker.on('error', (error) => log('error', 'crawl_worker_error', { error: error.message }));

  let stopping = false;
  const reconcile = async (): Promise<void> => {
    while (!stopping) {
      try {
        const queued = await crawlQueue.getJobs(['waiting', 'active', 'delayed'], 0, 500, true);
        const queuedIds = new Set(queued.map((job) => job.data.jobId));
        const missing = await repository.listQueuedForReconciliation(100);
        for (const jobId of missing) {
          if (!queuedIds.has(jobId)) await enqueueCrawlJob(jobId);
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
