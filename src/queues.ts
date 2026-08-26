import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const crawlQueue = new Queue<{ jobId: string }>('scrapper-crawl-v2', {
  connection: redis,
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
  await redis.ping();
}

export async function closeQueues(): Promise<void> {
  await crawlQueue.close();
  await redis.quit();
}
