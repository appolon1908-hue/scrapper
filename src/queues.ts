import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from './config.js';

export const redisConnection = {
  url: config.redisUrl,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
} satisfies ConnectionOptions;

export const crawlQueue = new Queue<{ jobId: string }, unknown, 'crawl'>('scrapper-crawl-v2', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 604_800, count: 20_000 },
  },
});

export async function enqueueCrawlJob(jobId: string): Promise<string> {
  const queueId = `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const job = await crawlQueue.add('crawl', { jobId }, { jobId: queueId });
  return String(job.id);
}

export async function pingRedis(): Promise<void> {
  await crawlQueue.waitUntilReady();
}

export async function closeQueues(): Promise<void> {
  await crawlQueue.close();
}
