import crypto from 'node:crypto';
import { mergeBusinessRecords } from '../domain/entity-resolution.js';
import type {
  BusinessRecord,
  CrawlJobRequest,
  ResultListQuery,
} from '../domain/schemas.js';
import { pool, withTransaction } from './db.js';
import type { BusinessResult } from './types.js';

export type SavePageInput = {
  tenantId: string;
  jobId: string;
  sourceUrl: string;
  canonicalUrl: string;
  statusCode?: number;
  contentHash: string;
  pageTitle: string;
  metadata: Record<string, unknown>;
};

export class BusinessRepository {
  async savePage(input: SavePageInput): Promise<void> {
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
        input.statusCode ?? null,
        input.contentHash,
        input.pageTitle,
        input.metadata,
      ],
    );
  }

  async upsert(
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
          [
            tenantId,
            id,
            stored.domain,
            stored.displayName,
            stored,
            stored.confidence,
            stored.lastSeenAt,
          ],
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
         on conflict(job_id,entity_id)
         do update set confidence=greatest(job_business_records.confidence,excluded.confidence)`,
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
                        consent_reference=coalesce(
                          excluded.consent_reference,
                          business_identifiers.consent_reference
                        ),
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

  async listForJob(
    tenantId: string,
    jobId: string,
    query: ResultListQuery,
  ): Promise<{ items: BusinessResult[]; nextCursor: string | null }> {
    const cursor = query.cursor || null;
    const owned = await pool.query(
      'select 1 from crawl_jobs where tenant_id=$1 and id=$2',
      [tenantId, jobId],
    );
    if (!owned.rowCount) throw new Error('not_found');

    const result = await pool.query<BusinessResult>(
      `select e.id,e.record
       from job_business_records j
       join business_entities e
         on e.id=j.entity_id and e.tenant_id=j.tenant_id
       where j.tenant_id=$1 and j.job_id=$2 and e.confidence >= $3
         and ($4::uuid is null or e.id > $4::uuid)
       order by e.id asc limit $5`,
      [tenantId, jobId, query.minConfidence, cursor, query.limit + 1],
    );
    const hasMore = result.rows.length > query.limit;
    const items = result.rows.slice(0, query.limit);
    return {
      items,
      nextCursor: hasMore ? items.at(-1)?.id || null : null,
    };
  }
}
