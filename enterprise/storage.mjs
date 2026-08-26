import crypto from 'node:crypto';
import pg from 'pg';
import { config } from './config.mjs';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.ENTERPRISE_DB_POOL_SIZE || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: `codestra-scrapper-enterprise-${config.role}`,
});

export async function pingDatabase() {
  await pool.query('SELECT 1');
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(client, event) {
  await client.query(
    `INSERT INTO enterprise_audit_events
      (tenant_id, actor_id, action, resource_type, resource_id, correlation_id, outcome, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      event.tenantId,
      event.actorId,
      event.action,
      event.resourceType,
      String(event.resourceId),
      event.correlationId,
      event.outcome,
      event.metadata || {},
    ],
  );
}

export async function createEnterpriseJob({
  tenantId,
  actorId,
  correlationId,
  idempotencyKey,
  source,
  profile,
  companies,
}) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM enterprise_jobs WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, idempotencyKey],
    );
    if (existing.rowCount) {
      const targets = await client.query(
        `SELECT * FROM enterprise_targets WHERE tenant_id=$1 AND job_id=$2 ORDER BY ordinal`,
        [tenantId, existing.rows[0].id],
      );
      return { job: existing.rows[0], targets: targets.rows, duplicate: true };
    }

    const jobResult = await client.query(
      `INSERT INTO enterprise_jobs
        (tenant_id, source, status, requested_by, correlation_id, idempotency_key, profile, total_targets, queued_targets)
       VALUES ($1,$2,'queued',$3,$4,$5,$6,$7,$7)
       RETURNING *`,
      [tenantId, source, actorId, correlationId, idempotencyKey, profile || {}, companies.length],
    );
    const job = jobResult.rows[0];
    const targets = [];
    for (const [index, company] of companies.entries()) {
      const result = await client.query(
        `INSERT INTO enterprise_targets
          (tenant_id, job_id, ordinal, business_name, website, normalized_domain,
           known_email, known_phone, known_owner, country_code, external_reference, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          tenantId,
          job.id,
          index + 1,
          company.businessName,
          company.website,
          company.normalizedDomain,
          company.knownEmail,
          company.knownPhone,
          company.knownOwner,
          company.countryCode,
          company.externalReference,
          company.tags || {},
        ],
      );
      targets.push(result.rows[0]);
    }
    await audit(client, {
      tenantId,
      actorId,
      action: 'enterprise_job.create',
      resourceType: 'enterprise_job',
      resourceId: job.id,
      correlationId,
      outcome: 'accepted',
      metadata: { source, target_count: companies.length },
    });
    return { job, targets, duplicate: false };
  });
}

export async function createDiscoveryRequest({
  tenantId,
  actorId,
  correlationId,
  idempotencyKey,
  provider,
  query,
  location,
  industry,
  countryCode,
  maxCompanies,
}) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM enterprise_discovery_requests
       WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantId, idempotencyKey],
    );
    if (existing.rowCount) return { request: existing.rows[0], duplicate: true };
    const result = await client.query(
      `INSERT INTO enterprise_discovery_requests
        (tenant_id, requested_by, correlation_id, idempotency_key, provider,
         query, location, industry, country_code, max_companies)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        tenantId,
        actorId,
        correlationId,
        idempotencyKey,
        provider,
        query,
        location || null,
        industry || null,
        countryCode,
        maxCompanies,
      ],
    );
    await audit(client, {
      tenantId,
      actorId,
      action: 'discovery.create',
      resourceType: 'discovery_request',
      resourceId: result.rows[0].id,
      correlationId,
      outcome: 'accepted',
      metadata: { provider, max_companies: maxCompanies },
    });
    return { request: result.rows[0], duplicate: false };
  });
}

export async function getDiscoveryRequest(tenantId, id) {
  const result = await pool.query(
    `SELECT * FROM enterprise_discovery_requests WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id],
  );
  return result.rows[0] || null;
}

export async function claimDiscoveryRequest(id) {
  const result = await pool.query(
    `UPDATE enterprise_discovery_requests
     SET status='running', updated_at=now()
     WHERE id=$1 AND status='queued'
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

export async function completeDiscoveryRequest(id, jobId, providerRequestId = null) {
  await pool.query(
    `UPDATE enterprise_discovery_requests
     SET status='completed', result_job_id=$2, provider_request_id=$3,
         completed_at=now(), updated_at=now(), error_code=NULL, error_message=NULL
     WHERE id=$1`,
    [id, jobId, providerRequestId],
  );
}

export async function failDiscoveryRequest(id, code, message) {
  await pool.query(
    `UPDATE enterprise_discovery_requests
     SET status='failed', error_code=$2, error_message=$3,
         completed_at=now(), updated_at=now()
     WHERE id=$1`,
    [id, code, String(message || '').slice(0, 2000)],
  );
}

export async function listEnterpriseJobs(tenantId, { status, limit = 50, cursor } = {}) {
  const parameters = [tenantId];
  const clauses = ['tenant_id=$1'];
  if (status) {
    parameters.push(status);
    clauses.push(`status=$${parameters.length}`);
  }
  if (cursor) {
    parameters.push(cursor);
    clauses.push(`created_at < $${parameters.length}::timestamptz`);
  }
  parameters.push(Math.min(Number(limit) || 50, 200));
  const result = await pool.query(
    `SELECT * FROM enterprise_jobs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${parameters.length}`,
    parameters,
  );
  return {
    items: result.rows,
    nextCursor: result.rows.length ? result.rows.at(-1).created_at : null,
  };
}

export async function getEnterpriseJob(tenantId, id) {
  const result = await pool.query(`SELECT * FROM enterprise_jobs WHERE tenant_id=$1 AND id=$2`, [
    tenantId,
    id,
  ]);
  return result.rows[0] || null;
}

export async function listTargets(tenantId, jobId, { status, limit = 200, afterOrdinal = 0 } = {}) {
  const parameters = [tenantId, jobId, Number(afterOrdinal) || 0];
  let statusClause = '';
  if (status) {
    parameters.push(status);
    statusClause = `AND status=$${parameters.length}`;
  }
  parameters.push(Math.min(Number(limit) || 200, 500));
  const result = await pool.query(
    `SELECT * FROM enterprise_targets
     WHERE tenant_id=$1 AND job_id=$2 AND ordinal>$3 ${statusClause}
     ORDER BY ordinal
     LIMIT $${parameters.length}`,
    parameters,
  );
  return result.rows;
}

export async function requestJobCancellation(tenantId, jobId, actorId, correlationId) {
  return withTransaction(async (client) => {
    const jobResult = await client.query(
      `UPDATE enterprise_jobs
       SET status='cancel_requested', updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','running')
       RETURNING *`,
      [tenantId, jobId],
    );
    if (!jobResult.rowCount) return null;
    await client.query(
      `UPDATE enterprise_targets
       SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,
           updated_at=now(), completed_at=CASE WHEN status='queued' THEN now() ELSE completed_at END
       WHERE tenant_id=$1 AND job_id=$2 AND status IN ('queued','running')`,
      [tenantId, jobId],
    );
    await audit(client, {
      tenantId,
      actorId,
      action: 'enterprise_job.cancel',
      resourceType: 'enterprise_job',
      resourceId: jobId,
      correlationId,
      outcome: 'accepted',
    });
    return jobResult.rows[0];
  });
}

export async function claimTarget(targetId, workerId) {
  const leaseToken = crypto.randomUUID();
  const result = await pool.query(
    `UPDATE enterprise_targets
     SET status='running', attempts=attempts+1, lease_token=$2, locked_by=$3,
         locked_at=now(), heartbeat_at=now(), updated_at=now(),
         error_code=NULL, error_message=NULL
     WHERE id=$1 AND status='queued' AND next_attempt_at<=now()
     RETURNING *`,
    [targetId, leaseToken, workerId],
  );
  return result.rows[0] || null;
}

export async function heartbeatTarget(targetId, leaseToken) {
  const result = await pool.query(
    `UPDATE enterprise_targets
     SET heartbeat_at=now(), updated_at=now()
     WHERE id=$1 AND lease_token=$2 AND status='running'
     RETURNING status`,
    [targetId, leaseToken],
  );
  return result.rows[0]?.status || null;
}

export async function targetCancellationRequested(targetId, leaseToken) {
  const result = await pool.query(
    `SELECT t.status, j.status AS job_status
     FROM enterprise_targets t
     JOIN enterprise_jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id
     WHERE t.id=$1 AND t.lease_token=$2`,
    [targetId, leaseToken],
  );
  const row = result.rows[0];
  return !row || row.status === 'cancel_requested' || row.job_status === 'cancel_requested';
}

function canonicalKey(tenantId, record, domain) {
  return crypto
    .createHash('sha256')
    .update(
      `${tenantId}|${domain}|${String(record?.legalName || record?.displayName || '').toLowerCase()}`,
    )
    .digest('hex');
}

export async function completeTarget(target, coreResult) {
  return withTransaction(async (client) => {
    const record = coreResult?.record || coreResult?.data || coreResult || {};
    const key = canonicalKey(target.tenant_id, record, target.normalized_domain);
    const confidence = Math.max(0, Math.min(1, Number(record.confidence || 0)));
    const entityResult = await client.query(
      `INSERT INTO enterprise_entities
        (tenant_id, canonical_key, status, record, confidence)
       VALUES ($1,$2,'pending_review',$3,$4)
       ON CONFLICT (tenant_id, canonical_key)
       DO UPDATE SET
         record=enterprise_entities.record || EXCLUDED.record,
         confidence=GREATEST(enterprise_entities.confidence, EXCLUDED.confidence),
         version=enterprise_entities.version+1,
         updated_at=now()
       RETURNING *`,
      [target.tenant_id, key, record, confidence],
    );
    const entity = entityResult.rows[0];
    await client.query(
      `UPDATE enterprise_targets
       SET status='completed', result_entity_id=$3, child_job_id=COALESCE($4, child_job_id),
           completed_at=now(), updated_at=now(), lease_token=NULL, locked_by=NULL,
           locked_at=NULL, heartbeat_at=NULL, error_code=NULL, error_message=NULL
       WHERE id=$1 AND lease_token=$2`,
      [target.id, target.lease_token, entity.id, coreResult?.childJobId || null],
    );
    await reconcileJobWithClient(client, target.tenant_id, target.job_id);
    return entity;
  });
}

export async function suppressTarget(target, reason) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE enterprise_targets
       SET status='suppressed', error_code='suppressed', error_message=$3,
           completed_at=now(), updated_at=now(), lease_token=NULL, locked_by=NULL,
           locked_at=NULL, heartbeat_at=NULL
       WHERE id=$1 AND lease_token=$2`,
      [target.id, target.lease_token, String(reason).slice(0, 1000)],
    );
    await reconcileJobWithClient(client, target.tenant_id, target.job_id);
  });
}

export async function failTarget(target, code, message, retryable = true) {
  await withTransaction(async (client) => {
    const retry = retryable && target.attempts < config.maxTargetAttempts;
    await client.query(
      `UPDATE enterprise_targets
       SET status=$3,
           next_attempt_at=CASE WHEN $3='queued' THEN now() + make_interval(secs => LEAST(3600, 15 * power(2, attempts))) ELSE next_attempt_at END,
           error_code=$4, error_message=$5,
           completed_at=CASE WHEN $3='failed' THEN now() ELSE NULL END,
           updated_at=now(), lease_token=NULL, locked_by=NULL, locked_at=NULL, heartbeat_at=NULL
       WHERE id=$1 AND lease_token=$2`,
      [
        target.id,
        target.lease_token,
        retry ? 'queued' : 'failed',
        code,
        String(message || '').slice(0, 2000),
      ],
    );
    await reconcileJobWithClient(client, target.tenant_id, target.job_id);
  });
}

async function reconcileJobWithClient(client, tenantId, jobId) {
  const countsResult = await client.query(
    `SELECT status, count(*)::integer AS count
     FROM enterprise_targets
     WHERE tenant_id=$1 AND job_id=$2
     GROUP BY status`,
    [tenantId, jobId],
  );
  const counts = Object.fromEntries(countsResult.rows.map((row) => [row.status, row.count]));
  const active = Number(counts.running || 0);
  const queued = Number(counts.queued || 0);
  const completed = Number(counts.completed || 0);
  const failed = Number(counts.failed || 0);
  const suppressed = Number(counts.suppressed || 0);
  const cancelled = Number(counts.cancelled || 0);
  const terminal = completed + failed + suppressed + cancelled;
  const totalResult = await client.query(
    `SELECT total_targets, status FROM enterprise_jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, jobId],
  );
  if (!totalResult.rowCount) return;
  const total = Number(totalResult.rows[0].total_targets);
  let status = active
    ? 'running'
    : queued
      ? 'queued'
      : total && terminal >= total
        ? 'completed'
        : 'running';
  if (terminal >= total && total > 0) {
    if (cancelled === total) status = 'cancelled';
    else if (completed === 0 && failed > 0) status = 'failed';
    else if (failed > 0 || suppressed > 0 || cancelled > 0) status = 'completed_with_errors';
    else status = 'completed';
  }
  await client.query(
    `UPDATE enterprise_jobs
     SET status=$3, queued_targets=$4, running_targets=$5, completed_targets=$6,
         failed_targets=$7, suppressed_targets=$8, updated_at=now(),
         completed_at=CASE WHEN $3 IN ('completed','completed_with_errors','failed','cancelled') THEN now() ELSE NULL END
     WHERE tenant_id=$1 AND id=$2`,
    [tenantId, jobId, status, queued, active, completed, failed, suppressed],
  );
}

export async function releaseStaleTargetLeases() {
  const result = await pool.query(
    `UPDATE enterprise_targets
     SET status=CASE WHEN attempts < $1 THEN 'queued' ELSE 'failed' END,
         next_attempt_at=now(), error_code='stale_worker_lease',
         error_message='The worker lease expired before completion',
         lease_token=NULL, locked_by=NULL, locked_at=NULL, heartbeat_at=NULL,
         completed_at=CASE WHEN attempts >= $1 THEN now() ELSE NULL END,
         updated_at=now()
     WHERE status='running'
       AND heartbeat_at < now() - make_interval(secs => $2)
     RETURNING tenant_id, job_id`,
    [config.maxTargetAttempts, config.leaseSeconds],
  );
  const jobs = new Set(result.rows.map((row) => `${row.tenant_id}|${row.job_id}`));
  for (const value of jobs) {
    const [tenantId, jobId] = value.split('|');
    await withTransaction((client) => reconcileJobWithClient(client, tenantId, jobId));
  }
  return result.rowCount || 0;
}

export async function isTargetSuppressed(target) {
  const domainHash = crypto.createHash('sha256').update(target.normalized_domain).digest('hex');
  const result = await pool.query(
    `SELECT reason FROM enterprise_suppressions
     WHERE tenant_id=$1 AND active
       AND ((suppression_type='domain' AND value_hash=$2)
         OR (suppression_type='entity' AND value_hash=$3))
     LIMIT 1`,
    [target.tenant_id, domainHash, crypto.createHash('sha256').update(target.id).digest('hex')],
  );
  return result.rows[0]?.reason || null;
}
