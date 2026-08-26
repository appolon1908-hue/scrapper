import crypto from 'node:crypto';
import type { JobListQuery } from '../domain/schemas.js';
import { pool, withTransaction } from './db.js';
import { insertAudit } from './audit-repository.js';
import { decodeCursor, encodeCursor, requestHash } from './serialization.js';
import type { CreateJobInput, JobRecord } from './types.js';

export class JobRepository {
  async create(input: CreateJobInput): Promise<{ job: JobRecord; duplicate: boolean }> {
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
        await insertAudit(client, {
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

  async get(tenantId: string, id: string): Promise<JobRecord | null> {
    const result = await pool.query<JobRecord>(
      'select * from crawl_jobs where tenant_id=$1 and id=$2',
      [tenantId, id],
    );
    return result.rows[0] || null;
  }

  async getForWorker(id: string): Promise<JobRecord | null> {
    const result = await pool.query<JobRecord>('select * from crawl_jobs where id=$1', [id]);
    return result.rows[0] || null;
  }

  async list(
    tenantId: string,
    query: JobListQuery,
  ): Promise<{ items: JobRecord[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    if (query.cursor && !cursor) throw new Error('invalid_cursor');

    const params: unknown[] = [tenantId, query.limit + 1];
    let sql = 'select * from crawl_jobs where tenant_id=$1';
    if (query.status) {
      params.push(query.status);
      sql += ` and status=$${params.length}`;
    }
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      sql += ` and (created_at,id) < ($${params.length - 1}::timestamptz,$${params.length}::uuid)`;
    }
    sql += ' order by created_at desc,id desc limit $2';

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
        await insertAudit(client, {
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

  async retry(
    tenantId: string,
    actorId: string,
    correlationId: string,
    id: string,
  ): Promise<JobRecord | null> {
    return withTransaction(async (client) => {
      const result = await client.query<JobRecord>(
        `update crawl_jobs
         set status='queued',progress='{}'::jsonb,error_code=null,error_message=null,
             cancellation_requested=false,started_at=null,completed_at=null,
             updated_at=now(),version=version+1
         where tenant_id=$1 and id=$2 and status in ('failed','cancelled')
         returning *`,
        [tenantId, id],
      );
      const job = result.rows[0] || null;
      if (job) {
        await insertAudit(client, {
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
      `update crawl_jobs
       set status='running',started_at=coalesce(started_at,now()),updated_at=now(),version=version+1
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

  async listQueuedForReconciliation(limit = 100): Promise<string[]> {
    const result = await pool.query<{ id: string }>(
      `select id from crawl_jobs
       where status='queued' and cancellation_requested=false
         and updated_at < now()-interval '15 seconds'
       order by created_at
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.id);
  }

  async cancellationRequested(id: string): Promise<boolean> {
    const result = await pool.query<{ cancellation_requested: boolean }>(
      'select cancellation_requested from crawl_jobs where id=$1',
      [id],
    );
    return result.rows[0]?.cancellation_requested ?? true;
  }
}
