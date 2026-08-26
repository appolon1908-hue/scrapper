import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { Repository } from '../../persistence/repository.js';
import { crawlQueue } from '../../queues.js';
import { requireScope } from '../../security/auth.js';

export async function registerOperationsRoutes(
  app: FastifyInstance,
  repository: Repository,
): Promise<void> {
  app.get('/api/v2/stats', async (request, reply) => {
    if (!(await requireScope(request, reply, 'operations:read'))) return;
    return repository.stats(request.principal.tenantId);
  });

  app.get('/api/v2/metrics', async (request, reply) => {
    if (!(await requireScope(request, reply, 'operations:read'))) return;
    const counts = await crawlQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );
    const memory = process.memoryUsage();
    const lines = [
      '# TYPE scrapper_process_uptime_seconds gauge',
      `scrapper_process_uptime_seconds ${process.uptime()}`,
      '# TYPE scrapper_process_resident_memory_bytes gauge',
      `scrapper_process_resident_memory_bytes ${memory.rss}`,
      '# TYPE scrapper_queue_jobs gauge',
      ...Object.entries(counts).map(
        ([status, value]) => `scrapper_queue_jobs{status="${status}"} ${value}`,
      ),
    ];
    return reply
      .type('text/plain; version=0.0.4')
      .send(`${lines.join('\n')}\n`);
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
      registry_provider_connected: false,
      durable_inbound_commands: false,
      admin_console_available: false,
      production_deployment_verified: false,
      ein_storage: 'masked_and_keyed_fingerprint_only',
    };
  });
}
