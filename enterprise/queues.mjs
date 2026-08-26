import { Queue } from 'bullmq';
import { config } from './config.mjs';

export function redisConnection() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.replace('/', '') || 0),
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: { servername: url.hostname } } : {}),
  };
}

const defaults = {
  attempts: 1,
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800, count: 25_000 },
};

export const targetQueue = new Queue('enterprise-company-targets', {
  connection: redisConnection(),
  defaultJobOptions: defaults,
});

export const discoveryQueue = new Queue('enterprise-business-discovery', {
  connection: redisConnection(),
  defaultJobOptions: defaults,
});

export const deliveryQueue = new Queue('enterprise-deliveries', {
  connection: redisConnection(),
  defaultJobOptions: defaults,
});

export const privacyQueue = new Queue('enterprise-privacy', {
  connection: redisConnection(),
  defaultJobOptions: defaults,
});

export async function enqueueTarget(target) {
  return targetQueue.add(
    'crawl-company',
    { targetId: target.id, tenantId: target.tenant_id, jobId: target.job_id },
    { jobId: `target:${target.id}` },
  );
}

export async function enqueueTargets(targets) {
  if (!targets.length) return [];
  return targetQueue.addBulk(
    targets.map((target) => ({
      name: 'crawl-company',
      data: { targetId: target.id, tenantId: target.tenant_id, jobId: target.job_id },
      opts: { jobId: `target:${target.id}` },
    })),
  );
}

export async function enqueueDiscovery(request) {
  return discoveryQueue.add(
    'discover-businesses',
    { discoveryId: request.id, tenantId: request.tenant_id },
    { jobId: `discovery:${request.id}` },
  );
}

export async function enqueueDelivery(delivery) {
  return deliveryQueue.add(
    'deliver',
    { deliveryId: delivery.id, tenantId: delivery.tenant_id },
    { jobId: `delivery:${delivery.id}` },
  );
}

export async function enqueuePrivacyRequest(request) {
  return privacyQueue.add(
    'privacy-request',
    { requestId: request.id, tenantId: request.tenant_id },
    { jobId: `privacy:${request.id}` },
  );
}

export async function closeQueues() {
  await Promise.all([targetQueue.close(), discoveryQueue.close(), deliveryQueue.close(), privacyQueue.close()]);
}
