import { Worker } from 'bullmq';
import { config } from '../config.js';
import { log } from '../log.js';
import { Repository } from '../persistence/repository.js';
import { crawlQueue, enqueueCrawlJob, redis } from '../queues.js';
import { runCrawlJob } from '../crawler/run.js';

export async function startCrawlWorker(repository = new Repository()): Promise<() => Promise<void>> {
  const worker = new Worker<{ jobId: string }>(
    'scrapper-crawl-v2',
    async (job) => runCrawlJob(job, repository),
    { connection: redis, concurrency: config.jobConcurrency },
  );
  worker.on('completed', (job) => log('info', 'crawl_job_worker_completed', { queueJobId: job.id }));
  worker.on('failed', (job, error) =>
    log('error', 'crawl_job_worker_failed', { queueJobId: job?.id, error: error.message }),
  );
  worker.on('error', (error) => log('error', 'crawl_worker_error', { error: error.message }));

  let stopping = false;
  const reconcile = async (): Promise<void> => {
    while (!stopping) {
      try {
        const queued = await crawlQueue.getJobs(['waiting', 'active', 'delayed'], 0, 500, true);
        const queuedIds = new Set(queued.map((job) => job.data.jobId));
        const result = await (await import('../persistence/db.js')).pool.query<{ id: string }>(
          `select id from crawl_jobs where status='queued' and cancellation_requested=false
           and updated_at < now()-interval '15 seconds' order by created_at limit 100`,
        );
        for (const row of result.rows) {
          if (!queuedIds.has(row.id)) await enqueueCrawlJob(row.id);
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
