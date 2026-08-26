import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { config } from '../config.js';
import {
  CrawlJobRequestSchema,
  JobListQuerySchema,
  ResultListQuerySchema,
  type CrawlJobRequest,
} from '../domain/schemas.js';
import { log } from '../log.js';
import { pingDatabase } from '../persistence/db.js';
import { Repository, type JobRecord } from '../persistence/repository.js';
import { crawlQueue, enqueueCrawlJob, pingRedis } from '../queues.js';
import { authenticateRequest, requireScope } from '../security/auth.js';

function header(request: FastifyRequest, name: string): string {
  return String(request.headers[name.toLowerCase()] || '').trim();
}

function jobView(job: JobRecord): Record<string, unknown> {
  return {
    id: job.id,
    tenant_id: job.tenant_id,
    correlation_id: job.correlation_id,
    status: job.status,
    progress: job.progress,
    error: job.error_code
      ? { code: job.error_code, message: job.error_message }
      : null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
  };
}

async function validateSensitiveRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: CrawlJobRequest,
): Promise<boolean> {
  if (payload.profile === 'registry') {
    if (!config.registryEnrichmentEnabled) {
      await reply.code(409).send({ error: 'registry_enrichment_disabled' });
      return false;
    }
    if (!(await requireScope(request, reply, 'registry:enrich'))) return false;
  }
  if (payload.verification?.knownEin) {
    if (!(await requireScope(request, reply, 'ein:verify'))) return false;
    if (!payload.verification.provider || !payload.verification.consentReference) {
      await reply.code(400).send({
        error: 'ein_verification_requires_provider_and_consent_reference',
      });
      return false;
    }
  }
  return true;
}

export async function buildApp(repository = new Repository()): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 1_000_000,
    requestIdHeader: 'x-correlation-id',
    genReqId: () => crypto.randomUUID(),
    trustProxy: false,
    disableRequestLogging: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/v2/')) await authenticateRequest(request, reply);
  });

  app.addHook('onResponse', async (request, reply) => {
    log('info', 'http_request', {
      requestId: request.id,
      method: request.method,
      path: request.routeOptions.url || request.url.split('?')[0],
      statusCode: reply.statusCode,
      responseTimeMs: reply.elapsedTime,
      tenantId: request.url.startsWith('/api/v2/') ? request.principal?.tenantId : undefined,
      clientId: request.url.startsWith('/api/v2/') ? request.principal?.clientId : undefined,
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === 'string' && error
          ? error
          : 'internal_error';
    if (message === 'idempotency_conflict') {
      await reply.code(409).send({ error: message });
      return;
    }
    if (message === 'not_found') {
      await reply.code(404).send({ error: message });
      return;
    }
    if (message === 'invalid_cursor') {
      await reply.code(400).send({ error: message });
      return;
    }
    log('error', 'http_request_failed', { requestId: request.id, error: message });
    await reply.code(500).send({ error: 'internal_error', request_id: request.id });
  });

  app.get('/', async () => ({
    service: 'codestra-business-scrapper',
    version: '2.0.0',
    api: '/api/v2',
    documentation: '/openapi.yaml',
  }));

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await Promise.all([pingDatabase(), pingRedis()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/openapi.yaml', async (_request, reply) => {
    const value = await fs.readFile(new URL('../../openapi/openapi.yaml', import.meta.url), 'utf8').catch(
      () => fs.readFile(`${process.cwd()}/openapi/openapi.yaml`, 'utf8'),
    );
    return reply.type('application/yaml; charset=utf-8').send(value);
  });

  const createJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireScope(request, reply, 'jobs:write'))) return;
    const parsed = CrawlJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_job', details: parsed.error.issues });
    }
    if (parsed.data.seedUrls.length > parsed.data.maxCompanies) {
      return reply.code(400).send({ error: 'seed_count_exceeds_max_companies' });
    }
    if (!(await validateSensitiveRequest(request, reply, parsed.data))) return;
    const idempotencyKey = header(request, 'idempotency-key');
    const correlationId = header(request, 'x-correlation-id');
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return reply.code(400).send({ error: 'valid_idempotency_key_required' });
    }
    if (!correlationId || correlationId.length > 200) {
      return reply.code(400).send({ error: 'valid_correlation_id_required' });
    }
    const created = await repository.createJob({
      tenantId: request.principal.tenantId,
      requestedBy: request.principal.clientId,
      correlationId,
      idempotencyKey,
      payload: parsed.data,
    });
    if (!created.duplicate && created.job.status === 'queued') {
      try {
        await enqueueCrawlJob(created.job.id);
      } catch (error) {
        log('warn', 'crawl_queue_enqueue_deferred', {
          jobId: created.job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return reply.code(created.duplicate ? 200 : 202).send({
      ...jobView(created.job),
      duplicate: created.duplicate,
    });
  };

  app.post('/api/v2/jobs', createJob);
  app.post('/api/v2/commands/crawl', createJob);

  app.get('/api/v2/jobs', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:read'))) return;
    const parsed = JobListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.issues });
    }
    const result = await repository.listJobs(request.principal.tenantId, parsed.data);
    return { items: result.items.map(jobView), next_cursor: result.nextCursor };
  });

  app.get('/api/v2/jobs/:id', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:read'))) return;
    const id = String((request.params as { id: string }).id);
    const job = await repository.getJob(request.principal.tenantId, id);
    return job ? jobView(job) : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v2/jobs/:id/results', async (request, reply) => {
    if (!(await requireScope(request, reply, 'results:read'))) return;
    const parsed = ResultListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', details: parsed.error.issues });
    }
    const id = String((request.params as { id: string }).id);
    const result = await repository.getResults(request.principal.tenantId, id, parsed.data);
    return { items: result.items, next_cursor: result.nextCursor };
  });

  app.post('/api/v2/jobs/:id/cancel', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:cancel'))) return;
    const correlationId = header(request, 'x-correlation-id');
    if (!correlationId) return reply.code(400).send({ error: 'correlation_id_required' });
    const id = String((request.params as { id: string }).id);
    const job = await repository.requestCancellation(
      request.principal.tenantId,
      request.principal.clientId,
      correlationId,
      id,
    );
    return job ? jobView(job) : reply.code(404).send({ error: 'not_found_or_not_cancellable' });
  });

  app.post('/api/v2/commands/jobs/:id/cancel', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:cancel'))) return;
    const correlationId = header(request, 'x-correlation-id');
    if (!correlationId) return reply.code(400).send({ error: 'correlation_id_required' });
    const id = String((request.params as { id: string }).id);
    const job = await repository.requestCancellation(
      request.principal.tenantId,
      request.principal.clientId,
      correlationId,
      id,
    );
    return job ? jobView(job) : reply.code(404).send({ error: 'not_found_or_not_cancellable' });
  });

  app.post('/api/v2/jobs/:id/retry', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:write'))) return;
    const correlationId = header(request, 'x-correlation-id');
    if (!correlationId) return reply.code(400).send({ error: 'correlation_id_required' });
    const id = String((request.params as { id: string }).id);
    const job = await repository.retryJob(
      request.principal.tenantId,
      request.principal.clientId,
      correlationId,
      id,
    );
    if (!job) return reply.code(409).send({ error: 'job_not_retryable' });
    await enqueueCrawlJob(job.id);
    return reply.code(202).send(jobView(job));
  });

  app.get('/api/v2/stats', async (request, reply) => {
    if (!(await requireScope(request, reply, 'operations:read'))) return;
    return repository.stats(request.principal.tenantId);
  });

  app.get('/api/v2/metrics', async (request, reply) => {
    if (!(await requireScope(request, reply, 'operations:read'))) return;
    const counts = await crawlQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    const memory = process.memoryUsage();
    const lines = [
      '# TYPE scrapper_process_uptime_seconds gauge',
      `scrapper_process_uptime_seconds ${process.uptime()}`,
      '# TYPE scrapper_process_resident_memory_bytes gauge',
      `scrapper_process_resident_memory_bytes ${memory.rss}`,
      ...Object.entries(counts).flatMap(([status, value]) => [
        '# TYPE scrapper_queue_jobs gauge',
        `scrapper_queue_jobs{status="${status}"} ${value}`,
      ]),
    ];
    return reply.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  app.get('/api/v2/capabilities', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:read'))) return;
    return {
      version: '2.0',
      max_companies_per_job: config.maxJobCompanies,
      max_pages_per_job: config.maxJobPages,
      robots_policy: 'required',
      private_network_crawling: false,
      login_or_captcha_bypass: false,
      external_delivery_enabled: config.externalDeliveryEnabled,
      registry_enrichment_enabled: config.registryEnrichmentEnabled,
      ein_storage: 'masked_and_keyed_fingerprint_only',
    };
  });

  return app;
}
