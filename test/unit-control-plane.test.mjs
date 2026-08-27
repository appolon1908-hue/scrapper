import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const routes = fs.readFileSync('src/api/routes/control-plane.ts', 'utf8');
const migration = fs.readFileSync('migrations/004_turnkey_control_plane.sql', 'utf8');
const environment = fs.readFileSync('.env.example', 'utf8');
test('turnkey control plane exposes tenant-safe operational resources', () => {
  for (const path of [
    '/platform/v2/tenants',
    '/api/v2/sources',
    '/api/v2/schedules',
    '/api/v2/integrations',
    '/api/v2/businesses',
    '/api/v2/reviews',
    '/api/v2/outbox',
    '/api/v2/inbox',
    '/api/v2/dead-letters',
    '/api/v2/exports',
    '/api/v2/audit-events',
  ])
    assert.match(routes, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const table of [
    'platform_tenants',
    'tenant_sources',
    'tenant_schedules',
    'tenant_integrations',
    'business_reviews',
    'control_inbox_messages',
    'control_dead_letters',
    'export_jobs',
  ])
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
});
test('external-effect controls are fail closed', () => {
  for (const flag of [
    'reviewMutationsEnabled',
    'scheduleExecutionEnabled',
    'outboxReplayEnabled',
    'exportProcessingEnabled',
  ])
    assert.match(routes, new RegExp(`config\\.${flag}`));
  for (const value of [
    'ENABLE_EXTERNAL_DELIVERY=false',
    'ENABLE_REGISTRY_ENRICHMENT=false',
    'ENABLE_REVIEW_MUTATIONS=false',
    'ENABLE_SCHEDULE_EXECUTION=false',
    'ENABLE_OUTBOX_REPLAY=false',
    'ENABLE_EXPORT_PROCESSING=false',
  ])
    assert.match(environment, new RegExp(`^${value}$`, 'm'));
});
