import type { FastifyInstance } from 'fastify';
import { buildApp } from './api/app.js';
import { config } from './config.js';
import { startDeliveryWorker } from './delivery/outbox.js';
import { log } from './log.js';
import { pool } from './persistence/db.js';
import { closeQueues } from './queues.js';
import { startCrawlWorker } from './workers/crawl-worker.js';

let app: FastifyInstance | null = null;
const stops: Array<() => Promise<void>> = [];

async function start(): Promise<void> {
  if (config.role === 'api' || config.role === 'all') {
    app = await buildApp();
    await app.listen({ host: '0.0.0.0', port: config.port });
    log('info', 'api_started', { port: config.port });
  }
  if (config.role === 'crawl-worker' || config.role === 'all') {
    stops.push(await startCrawlWorker());
    log('info', 'crawl_worker_started', { concurrency: config.jobConcurrency });
  }
  if (config.role === 'delivery-worker' || config.role === 'all') {
    stops.push(await startDeliveryWorker());
    log('info', 'delivery_worker_started', {
      externalDeliveryEnabled: config.externalDeliveryEnabled,
    });
  }
}

async function stop(signal: string): Promise<void> {
  log('info', 'shutdown_started', { signal });
  if (app) await app.close();
  for (const shutdown of stops.reverse()) await shutdown();
  await closeQueues();
  await pool.end();
  log('info', 'shutdown_complete');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void stop(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        log('error', 'shutdown_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  });
}

start().catch(async (error) => {
  log('error', 'startup_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await pool.end().catch(() => undefined);
  process.exit(1);
});
