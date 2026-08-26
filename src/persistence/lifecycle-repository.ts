import crypto from 'node:crypto';
import type pg from 'pg';
import { config } from '../config.js';
import type { BusinessRecord } from '../domain/schemas.js';
import { withTransaction } from './db.js';
import type { JobRecord } from './types.js';

export class LifecycleRepository {
  async finalizeJob(id: string, progress: Record<string, unknown>): Promise<void> {
    await withTransaction(async (client) => {
      const jobResult = await client.query<JobRecord>(
        'select * from crawl_jobs where id=$1 for update',
        [id],
      );
      const job = jobResult.rows[0];
      if (!job) throw new Error('job_not_found');

      if (job.cancellation_requested) {
        await client.query(
          `update crawl_jobs
           set status='cancelled',progress=$2,completed_at=now(),updated_at=now(),version=version+1
           where id=$1`,
          [id, progress],
        );
        await this.insertJobEvent(client, job, 'scraper.job.cancelled', progress);
        return;
      }

      const records = await client.query<{ id: string; record: BusinessRecord }>(
        `select e.id,e.record
         from job_business_records j
         join business_entities e
           on e.id=j.entity_id and e.tenant_id=j.tenant_id
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
        `update crawl_jobs
         set status='completed',progress=$2,completed_at=now(),updated_at=now(),version=version+1
         where id=$1`,
        [id, progress],
      );
    });
  }

  async failJob(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await withTransaction(async (client) => {
      const result = await client.query<JobRecord>(
        `update crawl_jobs
         set status=case when cancellation_requested then 'cancelled' else 'failed' end,
             error_code=$2,error_message=$3,completed_at=now(),updated_at=now(),version=version+1
         where id=$1 returning *`,
        [id, errorCode, errorMessage.slice(0, 2000)],
      );
      const job = result.rows[0];
      if (!job) return;

      await this.insertJobEvent(
        client,
        job,
        job.status === 'cancelled' ? 'scraper.job.cancelled' : 'scraper.job.failed',
        { error_code: errorCode },
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
}
