import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { JobCommandService } from '../../application/job-command-service.js';
import { config } from '../../config.js';
import {
  CrawlJobRequestSchema,
  JobListQuerySchema,
  ResultListQuerySchema,
  type CrawlJobRequest,
} from '../../domain/schemas.js';
import { Repository } from '../../persistence/repository.js';
import { requireScope } from '../../security/auth.js';
import { ApiError } from '../error-handler.js';
import { requiredHeader, uuidParam } from '../support/headers.js';
import { jobView } from '../support/job-view.js';

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

function commandContext(request: FastifyRequest): {
  tenantId: string;
  actorId: string;
  correlationId: string;
} {
  return {
    tenantId: request.principal.tenantId,
    actorId: request.principal.clientId,
    correlationId: requiredHeader(request, 'x-correlation-id', 'valid_correlation_id_required'),
  };
}

export async function registerJobRoutes(
  app: FastifyInstance,
  repository: Repository,
): Promise<void> {
  const commands = new JobCommandService(repository);

  const createJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireScope(request, reply, 'jobs:write'))) return;

    const parsed = CrawlJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, 'invalid_job', parsed.error.issues);
    }
    if (parsed.data.seedUrls.length > parsed.data.maxCompanies) {
      throw new ApiError(400, 'seed_count_exceeds_max_companies');
    }
    if (!(await validateSensitiveRequest(request, reply, parsed.data))) return;

    const idempotencyKey = requiredHeader(
      request,
      'idempotency-key',
      'valid_idempotency_key_required',
    );
    const created = await commands.create(commandContext(request), idempotencyKey, parsed.data);
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
      throw new ApiError(400, 'invalid_query', parsed.error.issues);
    }
    const result = await repository.listJobs(request.principal.tenantId, parsed.data);
    return {
      items: result.items.map(jobView),
      next_cursor: result.nextCursor,
    };
  });

  app.get('/api/v2/jobs/:id', async (request, reply) => {
    if (!(await requireScope(request, reply, 'jobs:read'))) return;
    const job = await repository.getJob(request.principal.tenantId, uuidParam(request, 'id'));
    return job ? jobView(job) : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/v2/jobs/:id/results', async (request, reply) => {
    if (!(await requireScope(request, reply, 'results:read'))) return;
    const parsed = ResultListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ApiError(400, 'invalid_query', parsed.error.issues);
    }
    const result = await repository.getResults(
      request.principal.tenantId,
      uuidParam(request, 'id'),
      parsed.data,
    );
    return {
      items: result.items,
      next_cursor: result.nextCursor,
    };
  });

  const cancelJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireScope(request, reply, 'jobs:cancel'))) return;
    const job = await commands.cancel(commandContext(request), uuidParam(request, 'id'));
    return job ? jobView(job) : reply.code(404).send({ error: 'not_found_or_not_cancellable' });
  };

  app.post('/api/v2/jobs/:id/cancel', cancelJob);
  app.post('/api/v2/commands/jobs/:id/cancel', cancelJob);

  const retryJob = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireScope(request, reply, 'jobs:write'))) return;
    const job = await commands.retry(commandContext(request), uuidParam(request, 'id'));
    return job
      ? reply.code(202).send(jobView(job))
      : reply.code(409).send({ error: 'job_not_retryable' });
  };

  app.post('/api/v2/jobs/:id/retry', retryJob);
  app.post('/api/v2/commands/jobs/:id/retry', retryJob);
}
