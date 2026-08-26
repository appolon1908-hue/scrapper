import os from 'node:os';
import { Worker } from 'bullmq';
import { request } from 'undici';
import { config } from './config.mjs';
import { discoverBusinesses } from './discovery.mjs';
import { enqueueTargets, redisConnection } from './queues.mjs';
import {
  claimDiscoveryRequest,
  claimTarget,
  completeDiscoveryRequest,
  completeTarget,
  createEnterpriseJob,
  failDiscoveryRequest,
  failTarget,
  getDiscoveryRequest,
  heartbeatTarget,
  isTargetSuppressed,
  releaseStaleTargetLeases,
  suppressTarget,
  targetCancellationRequested,
} from './storage.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function log(level, message, fields = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'codestra-scrapper-enterprise',
      ...fields,
    }),
  );
}

async function coreRequest(path, options = {}) {
  if (!config.coreApiToken) throw new Error('scrapper_core_token_missing');
  const response = await request(`${config.coreApiUrl}${path}`, {
    method: options.method || 'GET',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headersTimeout: 20_000,
    bodyTimeout: 20_000,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${config.coreApiToken}`,
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {}),
    },
  });
  const text = await response.body.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(`scrapper_core_${response.statusCode}`);
    error.statusCode = response.statusCode;
    error.response = body;
    throw error;
  }
  return body;
}

async function startChildCrawl(target) {
  const payload = {
    seedUrls: [target.website],
    profile: 'full',
    mode: 'domain',
    browser: 'auto',
    maxPages: Number(target.tags?.max_pages || 250),
    maxCompanies: 1,
    maxDepth: Number(target.tags?.max_depth || 3),
    requestsPerSecond: Number(target.tags?.requests_per_second || 1),
    includePatterns: [],
    excludePatterns: [],
    countryCode: target.country_code,
    callbackReference: `enterprise-target:${target.id}`,
    tags: {
      ...target.tags,
      enterprise_job_id: target.job_id,
      enterprise_target_id: target.id,
      external_reference: target.external_reference || '',
    },
  };
  const result = await coreRequest('/api/v2/jobs', {
    method: 'POST',
    body: payload,
    headers: {
      'x-tenant-id': target.tenant_id,
      'x-correlation-id': `enterprise-target-${target.id}`,
      'idempotency-key': `enterprise-target-${target.id}`,
    },
  });
  return result.id;
}

async function waitForChild(target, childJobId) {
  const deadline = Date.now() + config.coreApiTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await targetCancellationRequested(target.id, target.lease_token)) {
      await coreRequest(`/api/v2/jobs/${childJobId}/cancel`, {
        method: 'POST',
        headers: {
          'x-tenant-id': target.tenant_id,
          'x-correlation-id': `enterprise-cancel-${target.id}`,
        },
      }).catch(() => undefined);
      throw Object.assign(new Error('target_cancelled'), { retryable: false });
    }
    const status = await coreRequest(`/api/v2/jobs/${childJobId}`, {
      headers: { 'x-tenant-id': target.tenant_id },
    });
    if (status.status === 'completed') return status;
    if (status.status === 'failed') {
      throw Object.assign(new Error(status.error?.code || 'child_crawl_failed'), {
        retryable: true,
        details: status.error,
      });
    }
    if (status.status === 'cancelled') {
      throw Object.assign(new Error('child_crawl_cancelled'), { retryable: false });
    }
    const leaseStatus = await heartbeatTarget(target.id, target.lease_token);
    if (!leaseStatus) throw Object.assign(new Error('target_lease_lost'), { retryable: true });
    await sleep(config.coreApiPollSeconds * 1000);
  }
  throw Object.assign(new Error('child_crawl_timeout'), { retryable: true });
}

async function fetchChildResult(target, childJobId) {
  const result = await coreRequest(`/api/v2/jobs/${childJobId}/results?limit=100&minConfidence=0`, {
    headers: { 'x-tenant-id': target.tenant_id },
  });
  const items = Array.isArray(result.items)
    ? result.items
    : Array.isArray(result.results)
      ? result.results
      : [];
  if (!items.length) {
    throw Object.assign(new Error('child_crawl_no_business_record'), { retryable: false });
  }
  return items[0];
}

async function processTarget(job) {
  const workerId = `${os.hostname()}-${process.pid}`;
  const target = await claimTarget(job.data.targetId, workerId);
  if (!target) return { skipped: true };
  try {
    const suppression = await isTargetSuppressed(target);
    if (suppression) {
      await suppressTarget(target, suppression);
      return { status: 'suppressed' };
    }
    const childJobId = target.child_job_id || (await startChildCrawl(target));
    await waitForChild(target, childJobId);
    const record = await fetchChildResult(target, childJobId);
    const entity = await completeTarget(target, { record, childJobId });
    log('info', 'enterprise_target_completed', {
      targetId: target.id,
      jobId: target.job_id,
      childJobId,
      entityId: entity.id,
      tenantId: target.tenant_id,
    });
    return { status: 'completed', childJobId, entityId: entity.id };
  } catch (error) {
    const retryable = error?.retryable !== false;
    const code = error instanceof Error ? error.message : 'target_failed';
    await failTarget(
      target,
      code,
      error instanceof Error ? error.message : String(error),
      retryable,
    );
    log('warn', 'enterprise_target_failed', {
      targetId: target.id,
      jobId: target.job_id,
      tenantId: target.tenant_id,
      code,
      retryable,
    });
    if (retryable) throw error;
    return { status: 'failed', code };
  }
}

async function processDiscovery(job) {
  const queued = await getDiscoveryRequest(job.data.tenantId, job.data.discoveryId);
  if (!queued) return { skipped: true };
  const discovery = await claimDiscoveryRequest(queued.id);
  if (!discovery) return { skipped: true };
  try {
    const result = await discoverBusinesses({
      provider: discovery.provider,
      query: discovery.query,
      location: discovery.location,
      industry: discovery.industry,
      countryCode: discovery.country_code,
      maxCompanies: discovery.max_companies,
    });
    if (!result.companies.length) throw new Error('discovery_no_official_websites_found');
    const created = await createEnterpriseJob({
      tenantId: discovery.tenant_id,
      actorId: discovery.requested_by,
      correlationId: discovery.correlation_id,
      idempotencyKey: `discovery-result:${discovery.id}`,
      source: 'discovery',
      profile: {
        discovery_id: discovery.id,
        discovery_provider: result.provider,
        discovery_query: discovery.query,
      },
      companies: result.companies,
    });
    if (!created.duplicate) await enqueueTargets(created.targets);
    await completeDiscoveryRequest(discovery.id, created.job.id, result.providerRequestId);
    log('info', 'enterprise_discovery_completed', {
      discoveryId: discovery.id,
      jobId: created.job.id,
      tenantId: discovery.tenant_id,
      companies: created.targets.length,
    });
    return { jobId: created.job.id, companies: created.targets.length };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'discovery_failed';
    await failDiscoveryRequest(discovery.id, code, code);
    log('warn', 'enterprise_discovery_failed', {
      discoveryId: discovery.id,
      tenantId: discovery.tenant_id,
      code,
    });
    throw error;
  }
}

export function startTargetWorker() {
  const worker = new Worker('enterprise-company-targets', processTarget, {
    connection: redisConnection(),
    concurrency: config.targetConcurrency,
    lockDuration: config.leaseSeconds * 1000,
  });
  const timer = setInterval(
    () => {
      releaseStaleTargetLeases()
        .then((count) => {
          if (count) log('warn', 'stale_target_leases_released', { count });
        })
        .catch((error) => log('error', 'stale_target_release_failed', { error: String(error) }));
    },
    Math.max(30, Math.floor(config.leaseSeconds / 2)) * 1000,
  );
  timer.unref();
  return async () => {
    clearInterval(timer);
    await worker.close();
  };
}

export function startDiscoveryWorker() {
  const worker = new Worker('enterprise-business-discovery', processDiscovery, {
    connection: redisConnection(),
    concurrency: config.discoveryConcurrency,
  });
  return () => worker.close();
}
