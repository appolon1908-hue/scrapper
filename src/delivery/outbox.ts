import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { Agent, request } from 'undici';
import { config } from '../config.js';
import { log } from '../log.js';
import {
  Repository,
  type OutboxEvent,
} from '../persistence/repository.js';
import { signRequest } from '../security/signature.js';
import {
  isAllowedServiceUrl,
  isProhibitedAddress,
} from '../security/url-policy.js';

function readOptional(path: string): Buffer | undefined {
  return path ? fs.readFileSync(path) : undefined;
}

async function serviceAgent(rawUrl: string): Promise<Agent> {
  if (!isAllowedServiceUrl(rawUrl, config.outboundAllowedHosts)) {
    throw new Error('outbound_destination_not_allowlisted');
  }

  const url = new URL(rawUrl);
  const resolved = net.isIP(url.hostname)
    ? [{ address: url.hostname, family: net.isIPv4(url.hostname) ? 4 : 6 }]
    : await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!resolved.length) throw new Error('outbound_dns_resolution_failed');

  const explicitlyAllowed = config.outboundAllowedHosts.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
  if (!explicitlyAllowed && resolved.some((item) => isProhibitedAddress(item.address))) {
    throw new Error('outbound_private_destination_rejected');
  }

  const pinned = resolved[0]!;
  const ca = readOptional(config.outboundCaFile);
  const cert = readOptional(config.outboundClientCertFile);
  const key = readOptional(config.outboundClientKeyFile);
  return new Agent({
    connect: {
      ...(ca ? { ca } : {}),
      ...(cert ? { cert } : {}),
      ...(key ? { key } : {}),
      rejectUnauthorized: config.nodeEnv === 'production',
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
    },
  });
}

function deliveryScopes(event: OutboxEvent): string[] {
  return event.event_type === 'scraper.business.batch.ready'
    ? ['scraper.results.write']
    : ['scraper.events.write'];
}

function correlationId(event: OutboxEvent): string | undefined {
  const value = event.payload.correlation_id;
  return typeof value === 'string' && value ? value : undefined;
}

async function deliver(event: OutboxEvent): Promise<void> {
  if (!config.externalDeliveryEnabled) throw new Error('external_delivery_disabled');
  if (!config.middlewareBaseUrl) throw new Error('middleware_base_url_missing');
  if (!config.outboundBearerToken) throw new Error('outbound_bearer_token_missing');
  if (!config.outboundHmacSecret) throw new Error('outbound_hmac_secret_missing');

  const target = new URL(
    event.destination_path,
    `${config.middlewareBaseUrl}/`,
  ).toString();
  const body = JSON.stringify(event.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const scopes = deliveryScopes(event);
  const correlation = correlationId(event);
  const signature = signRequest(config.outboundHmacSecret, {
    method: 'POST',
    path: new URL(target).pathname + new URL(target).search,
    timestamp,
    eventId: event.id,
    source: 'codestra-scrapper',
    tenantId: event.tenant_id,
    idempotencyKey: event.idempotency_key,
    scopes,
    body,
  });

  const dispatcher = await serviceAgent(target);
  try {
    const response = await request(target, {
      dispatcher,
      method: 'POST',
      body,
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${config.outboundBearerToken}`,
        'content-type': 'application/json',
        'user-agent': config.scraperUserAgent,
        'x-source-system': 'codestra-scrapper',
        'x-event-type': event.event_type,
        'x-scrapper-signature-version': 'v2',
        'x-scrapper-timestamp': timestamp,
        'x-scrapper-event-id': event.id,
        'x-scrapper-scopes': scopes.join(' '),
        'x-tenant-id': event.tenant_id,
        'idempotency-key': event.idempotency_key,
        ...(correlation ? { 'x-correlation-id': correlation } : {}),
        'x-scrapper-signature': signature,
      },
    });
    const responseBody = await response.body.text();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `middleware_delivery_${response.statusCode}:${responseBody.slice(0, 500)}`,
      );
    }
  } finally {
    await dispatcher.close();
  }
}

export async function startDeliveryWorker(
  repository = new Repository(),
): Promise<() => Promise<void>> {
  const workerId = `${os.hostname()}-${process.pid}`;
  let stopping = false;
  let staleCounter = 0;

  const loop = async (): Promise<void> => {
    while (!stopping) {
      if (!config.externalDeliveryEnabled) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }

      if (staleCounter++ % 30 === 0) {
        await repository.releaseStaleOutboxLocks();
      }
      const events = await repository.claimOutbox(workerId, 20);
      if (!events.length) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }

      for (const event of events) {
        try {
          await deliver(event);
          await repository.markOutboxDelivered(event.id);
          log('info', 'outbox_delivered', {
            eventId: event.id,
            eventType: event.event_type,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await repository.markOutboxFailed(event.id, message);
          log('warn', 'outbox_delivery_failed', {
            eventId: event.id,
            eventType: event.event_type,
            error: message,
          });
        }
      }
    }
  };

  const running = loop().catch((error) => {
    log('error', 'delivery_worker_crashed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
  return async () => {
    stopping = true;
    await running;
  };
}
