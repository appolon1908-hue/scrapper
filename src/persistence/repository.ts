import crypto from 'node:crypto';
import type pg from 'pg';
import { config } from '../config.js';
import { mergeBusinessRecords } from '../domain/entity-resolution.js';
import type {
  BusinessRecord,
  CrawlJobRequest,
  JobListQuery,
  JobStatus,
  ResultListQuery,
} from '../domain/schemas.js';
import { pool, withTransaction } from './db.js';

export type JobRecord = {
  id: string;
  tenant_id: string;
  requested_by: string;
  correlation_id: string;
  idempotency_key: string;
  status: JobStatus;
  payload: CrawlJobRequest;
  progress: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  cancellation_requested: boolean;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

export type OutboxEvent = {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  destination_path: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
};

type CreateJobInput = {
  tenantId: string;
  requestedBy: string;
  correlationId: string;
  idempotencyKey: string;
  payload: CrawlJobRequest;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(payload: CrawlJobRequest): string {
  return crypto.createHash('sha256').update(stable(payload)).digest('hex');
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function audit(
  client: pg.PoolClient,
  input: {
    tenantId: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into audit_events(
      tenant_id,actor_id,action,resource_type,resource_id,correlation_id,metadata
    ) values($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.tenantId,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.correlationId || null,
      input.metadata || {},
    ],
  );
}

export class Repository {
  async createJob(input: CreateJobInput): Promise<{ job: JobRecord; duplicate: boolean }> {
    const hash = requestHash(input.payload);
    return withTransaction(async (client) => {
      const id = crypto.randomUUID();
      const inserted = await client.query<JobRecord>(
        `insert into crawl_jobs(
          id,tenant_id,requested_by,correlation_id,idempotency_key,request_hash,status,payload
        ) values($1,$2,$3,$4,$5,$6,'queued',$7)
        on conflict(tenant_id,idempotency_key) do nothing
        returning *`,
        [
          id,
          input.tenantId,
          input.requestedBy,
          input.correlationId,
          input.idempotencyKey,
          hash,
          input.payload,
        ],
      );
      if (inserted.rowCount) {
        const job = inserted.rows[0]!;
        await audit(client, {
          tenantId: input.tenantId,
          actorId: input.requestedBy,
          action: 'crawl_job.created',
          resourceType: 'crawl_job',
          resourceId: job.id,
          correlationId: input.correlationId,
          metadata: { idempotency_key: input.idempotencyKey },
        });
        return { job, duplicate: false };
      }

      const prior = await client.query<JobRecord & { request_hash: string }>(
        `select * from crawl_jobs where tenant_id=$1 and idempotency_key=$2 for update`,
        [input.tenantId, input.idempotencyKey],
      );
      const job = prior.rows[0];
      if (!job) throw new Error('idempotency_lookup_failed');
      if (job.request_hash !== hash) throw new Error('idempotency_conflict');
      return { job, duplicate: true };
    });
  }

  async getJob(tenantId: string, id: string): Promise<JobRecord | null> {
    const result = await pool.query<JobRecord>(
      'select * from crawl_jobs where tenant_id=$1 and id=$2',
      [tenantId, id],
    );
    return result.rows[0] || null;
  }

  async getJobForWorker(id: string): Promise<JobRecord | null> {
    const result = await pool.query<JobRecord>('select * from crawl_jobs where id=$1', [id]);
    return result.rows[0] || null;
  }

  async listJobs(tenantId: string, query: JobListQuery): Promise<{
    items: JobRecord[];
    nextCursor: string | null;
  }> {
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) throw new Error('invalid_cursor');
    const params: unknown[] = [tenantId, query.limit + 1];
    let sql = `select * from crawl_jobs where tenant_id=$1`;
    if (query.status) {
      params.push(query.status);
      sql += ` and status=$${params.length}`;
    }
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      sql += ` and (created_at,id) < ($${params.length - 1}::timestamptz,$${params.length}::uuid)`;
    }
    sql += ` order by created_at desc,id desc limit $2`;
    const result = await pool.query<JobRecord>(sql, params);
    const hasMore = result.rows.length > query.limit;
    const items = result.rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async requestCancellation(
    tenantId: string,
    actorId: string,
    correlationId: string,
    id: string,
  ): Promise<JobRecord | null> {
    return withTransaction(async (client) => {
      const result = await client.query<JobRecord>(
        `update crawl_jobs
         set cancellation_requested=true,
             status=case when status='queued' then 'cancelled' else 'cancel_requested' end,
             completed_at=case when status='queued' then now() else completed_at end,
             updated_at=now(),version=version+1
         where tenant_id=$1 and id=$2 and status in ('queued','running','cancel_requested')
         returning *`,
        [tenantId, id],
      );
      const job = result.rows[0] || null;
      if (job) {
        await audit(client, {
          tenantId,
          actorId,
          action: 'crawl_job.cancel_requested',
          resourceType: 'crawl_job',
          resourceId: id,
          correlationId,
        });
      }
      return job;
    });
  }

  async retryJob(
    tenantId: string,
    actorId: string,
    correlationId: string,
    id: string,
  ): Promise<JobRecord | null> {
    return withTransaction(async (client) => {
      const result = await client.query<JobRecord>(
        `update crawl_jobs
         set status='queued',progress='{}'::jsonb,error_code=null,error_message=null,
             cancellation_requested=false,started_at=null,completed_at=null,updated_at=now(),version=version+1
         where tenant_id=$1 and id=$2 and status in ('failed','cancelled')
         returning *`,
        [tenantId, id],
      );
      const job = result.rows[0] || null;
      if (job) {
        await audit(client, {
          tenantId,
          actorId,
          action: 'crawl_job.retried',
          resourceType: 'crawl_job',
          resourceId: id,
          correlationId,
        });
      }
      return job;
    });
  }

  async markRunning(id: string): Promise<boolean> {
    const result = await pool.query(
      `update crawl_jobs set status='running',started_at=coalesce(started_at,now()),updated_at=now(),version=version+1
       where id=$1 and status='queued' and cancellation_requested=false`,
      [id],
    );
    return (result.rowCount || 0) === 1;
  }

  async updateProgress(id: string, progress: Record<string, unknown>): Promise<void> {
    await pool.query(
      `update crawl_jobs set progress=$2,updated_at=now(),version=version+1
       where id=$1 and status in ('running','cancel_requested')`,
      [id, progress],
    );
  }

  async cancellationRequested(id: string): Promise<boolean> {
    const result = await pool.query<{ cancellation_requested: boolean }>(
      'select cancellation_requested from crawl_jobs where id=$1',
      [id],
    );
    return result.rows[0]?.cancellation_requested ?? true;
  }

  async savePage(input: {
    tenantId: string;
    jobId: string;
    sourceUrl: string;
    canonicalUrl: string;
    statusCode?: number;
    contentHash: string;
    pageTitle: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await pool.query(
      `insert into crawl_pages(
        tenant_id,job_id,source_url,canonical_url,status_code,content_hash,page_title,metadata
      ) values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(job_id,source_url,content_hash) do nothing`,
      [
        input.tenantId,
        input.jobId,
        input.sourceUrl,
        input.canonicalUrl,
        input.statusCode || null,
        input.contentHash,
        input.pageTitle,
        input.metadata,
      ],
    );
  }

  async upsertBusiness(
    tenantId: string,
    jobId: string,
    record: BusinessRecord,
    verification?: CrawlJobRequest['verification'],
  ): Promise<string> {
    return withTransaction(async (client) => {
      const prior = await client.query<{ id: string; record: BusinessRecord }>(
        'select id,record from business_entities where tenant_id=$1 and entity_key=$2 for update',
        [tenantId, record.entityKey],
      );
      let id: string;
      let stored = record;
      if (prior.rowCount) {
        id = prior.rows[0]!.id;
        stored = mergeBusinessRecords(prior.rows[0]!.record, record);
        await client.query(
          `update business_entities
           set domain=$3,display_name=$4,record=$5,confidence=$6,last_seen_at=$7,updated_at=now()
           where tenant_id=$1 and id=$2`,
          [tenantId, id, stored.domain, stored.displayName, stored, stored.confidence, stored.lastSeenAt],
        );
      } else {
        id = crypto.randomUUID();
        await client.query(
          `insert into business_entities(
            id,tenant_id,entity_key,domain,display_name,record,confidence,first_seen_at,last_seen_at
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            tenantId,
            stored.entityKey,
            stored.domain,
            stored.displayName,
            stored,
            stored.confidence,
            stored.firstSeenAt,
            stored.lastSeenAt,
          ],
        );
      }
      await client.query(
        `insert into job_business_records(job_id,entity_id,tenant_id,confidence)
         values($1,$2,$3,$4)
         on conflict(job_id,entity_id) do update set confidence=greatest(job_business_records.confidence,excluded.confidence)`,
        [jobId, id, tenantId, stored.confidence],
      );
      if (stored.einFingerprint) {
        await client.query(
          `insert into business_identifiers(
            id,tenant_id,entity_id,identifier_type,masked_value,fingerprint,verification_status,
            provider,consent_reference,evidence
          ) values($1,$2,$3,'ein',$4,$5,$6,$7,$8,$9)
          on conflict(tenant_id,entity_id,identifier_type,fingerprint)
          do update set verification_status=excluded.verification_status,
                        provider=coalesce(excluded.provider,business_identifiers.provider),
                        consent_reference=coalesce(excluded.consent_reference,business_identifiers.consent_reference),
                        evidence=excluded.evidence,last_seen_at=now()`,
          [
            crypto.randomUUID(),
            tenantId,
            id,
            stored.einMasked,
            stored.einFingerprint,
            stored.einStatus,
            verification?.provider || null,
            verification?.consentReference || null,
            stored.evidence.ein || [],
          ],
        );
      }
      return id;
    });
  }

  async getResults(
    tenantId: string,
    jobId: string,
    query: ResultListQuery,
  ): Promise<{ items: Array<{ id: string; record: BusinessRecord }>; nextCursor: string | null }> {
    const cursor = query.cursor || null;
    const owned = await pool.query('select 1 from crawl_jobs where tenant_id=$1 and id=$2', [
      tenantId,
      jobId,
    ]);
    if (!owned.rowCount) throw new Error('not_found');
    const result = await pool.query<{ id: string; record: BusinessRecord }>(
      `select e.id,e.record
       from job_business_records j join business_entities e on e.id=j.entity_id
       where j.tenant_id=$1 and j.job_id=$2 and e.confidence >= $3
         and ($4::uuid is null or e.id > $4::uuid)
       order by e.id asc limit $5`,
      [tenantId, jobId, query.minConfidence, cursor, query.limit + 1],
    );
    const hasMore = result.rows.length > query.limit;
    const items = result.rows.slice(0, query.limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id || null : null };
  }

  async finalizeJob(id: string, progress: Record<string, unknown>): Promise<void> {
    await withTransaction(async (client) => {
      const jobResult = await client.query<JobRecord>(
        `select * from crawl_jobs where id=$1 for update`,
        [id],
      );
      const job = jobResult.rows[0];
      if (!job) throw new Error('job_not_found');
      if (job.cancellation_requested) {
        await client.query(
          `update crawl_jobs set status='cancelled',progress=$2,completed_at=now(),updated_at=now(),version=version+1 where id=$1`,
          [id, progress],
        );
        await this.insertJobEvent(client, job, 'scraper.job.cancelled', progress);
        return;
      }

      const records = await client.query<{ id: string; record: BusinessRecord }>(
        `select e.id,e.record from job_business_records j
         join business_entities e on e.id=j.entity_id
         where j.job_id=$1 order by e.id`,
        [id],
      );
      for (let offset = 0; offset < records.rows.length; offset += config.deliveryBatchSize) {
        const batch = records.rows.slice(offset, offset + config.deliveryBatchSize);
        const eventId = crypto.randomUUID();
        const batchNumber = Math.floor(offset / config.deliveryBatchSize) + 1;
        await client.query(
          `insert into outbox_events(
            id,tenant_id,aggregate_type,aggregate_id,event_type,destination_path,payload,idempotency_key
          ) values($1,$2,'crawl_job',$3,'scraper.business.batch.ready',$4,$5,$6)
          on conflict(tenant_id,idempotency_key) do nothing`,
          [
            eventId,
            job.tenant_id,
            job.id,
            config.middlewareResultsPath,
            {
              schema_version: '2.0',
              event_id: eventId,
              event_type: 'scraper.business.batch.ready',
              tenant_id: job.tenant_id,
              job_id: job.id,
              correlation_id: job.correlation_id,
              batch_number: batchNumber,
              records: batch.map((item) => ({ record_id: item.id, ...item.record })),
            },
            `job:${job.id}:results:${batchNumber}`,
          ],
        );
      }
      await this.insertJobEvent(client, job, 'scraper.job.completed', {
        ...progress,
        business_records: records.rowCount || 0,
      });
      await client.query(
        `update crawl_jobs set status='completed',progress=$2,completed_at=now(),updated_at=now(),version=version+1 where id=$1`,
        [id, progress],
      );
    });
  }

  private async insertJobEvent(
    client: pg.PoolClient,
    job: JobRecord,
    eventType: string,
    progress: Record<string, unknown>,
  ): Promise<void> {
    const eventId = crypto.randomUUID();
    await client.query(
      `insert into outbox_events(
        id,tenant_id,aggregate_type,aggregate_id,event_type,destination_path,payload,idempotency_key
      ) values($1,$2,'crawl_job',$3,$4,$5,$6,$7)
      on conflict(tenant_id,idempotency_key) do nothing`,
      [
        eventId,
        job.tenant_id,
        job.id,
        eventType,
        config.middlewareEventsPath,
        {
          schema_version: '2.0',
          event_id: eventId,
          event_type: eventType,
          tenant_id: job.tenant_id,
          job_id: job.id,
          correlation_id: job.correlation_id,
          status: eventType.split('.').at(-1),
          progress,
        },
        `job:${job.id}:event:${eventType}`,
      ],
    );
  }

  async failJob(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await withTransaction(async (client) => {
      const result = await client.query<JobRecord>(
        `update crawl_jobs set status=case when cancellation_requested then 'cancelled' else 'failed' end,
          error_code=$2,error_message=$3,completed_at=now(),updated_at=now(),version=version+1
         where id=$1 returning *`,
        [id, errorCode, errorMessage.slice(0, 2000)],
      );
      const job = result.rows[0];
      if (job) {
        await this.insertJobEvent(
          client,
          job,
          job.status === 'cancelled' ? 'scraper.job.cancelled' : 'scraper.job.failed',
          { error_code: errorCode },
        );
      }
    });
  }

  async claimOutbox(workerId: string, limit = 20): Promise<OutboxEvent[]> {
    return withTransaction(async (client) => {
      const result = await client.query<OutboxEvent>(
        `with candidates as (
          select id from outbox_events
          where status='pending' and available_at <= now()
          order by created_at
          for update skip locked
          limit $2
        )
        update outbox_events o
        set status='processing',locked_at=now(),locked_by=$1,updated_at=now()
        from candidates c where o.id=c.id
        returning o.*`,
        [workerId, limit],
      );
      return result.rows;
    });
  }

  async markOutboxDelivered(id: string): Promise<void> {
    await pool.query(
      `update outbox_events set status='delivered',delivered_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=$1`,
      [id],
    );
  }

  async markOutboxFailed(id: string, error: string): Promise<void> {
    const prior = await pool.query<{ attempts: number }>(
      'select attempts from outbox_events where id=$1',
      [id],
    );
    const attempts = (prior.rows[0]?.attempts || 0) + 1;
    const dead = attempts >= config.deliveryMaxAttempts;
    const delaySeconds = Math.min(3600, 5 * 2 ** Math.min(attempts, 10));
    await pool.query(
      `update outbox_events
       set status=$2,attempts=$3,last_error=$4,available_at=now()+($5*interval '1 second'),
           locked_at=null,locked_by=null,updated_at=now()
       where id=$1`,
      [id, dead ? 'dead_letter' : 'pending', attempts, error.slice(0, 2000), delaySeconds],
    );
  }

  async releaseStaleOutboxLocks(): Promise<number> {
    const result = await pool.query(
      `update outbox_events set status='pending',locked_at=null,locked_by=null,updated_at=now()
       where status='processing' and locked_at < now()-interval '10 minutes'`,
    );
    return result.rowCount || 0;
  }

  async stats(tenantId: string): Promise<Record<string, unknown>> {
    const jobs = await pool.query<{ status: string; count: string }>(
      'select status,count(*)::text from crawl_jobs where tenant_id=$1 group by status',
      [tenantId],
    );
    const entities = await pool.query<{ count: string }>(
      'select count(*)::text from business_entities where tenant_id=$1',
      [tenantId],
    );
    const outbox = await pool.query<{ status: string; count: string }>(
      'select status,count(*)::text from outbox_events where tenant_id=$1 group by status',
      [tenantId],
    );
    return {
      jobs: Object.fromEntries(jobs.rows.map((row) => [row.status, Number(row.count)])),
      business_entities: Number(entities.rows[0]?.count || 0),
      outbox: Object.fromEntries(outbox.rows.map((row) => [row.status, Number(row.count)])),
    };
  }

  async retentionSweep(): Promise<{ pages: number; jobs: number }> {
    const pages = await pool.query(
      `delete from crawl_pages where captured_at < now()-($1*interval '1 day')`,
      [config.rawPageRetentionDays],
    );
    const jobs = await pool.query(
      `delete from crawl_jobs where completed_at is not null and completed_at < now()-($1*interval '1 day')`,
      [config.dataRetentionDays],
    );
    return { pages: pages.rowCount || 0, jobs: jobs.rowCount || 0 };
  }
}
