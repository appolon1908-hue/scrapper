import type pg from 'pg';
import type { AuditInput } from './types.js';

export async function insertAudit(
  client: pg.PoolClient,
  input: AuditInput,
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
