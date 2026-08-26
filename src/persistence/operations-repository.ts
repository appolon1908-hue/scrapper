import { config } from '../config.js';
import { pool } from './db.js';

export class OperationsRepository {
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
      `delete from crawl_jobs
       where completed_at is not null and completed_at < now()-($1*interval '1 day')`,
      [config.dataRetentionDays],
    );
    return { pages: pages.rowCount || 0, jobs: jobs.rowCount || 0 };
  }
}
