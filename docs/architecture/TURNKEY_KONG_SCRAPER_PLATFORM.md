# Codestra Turnkey Kong Scraper Platform

Status: source architecture and implementation contract. This document does not claim a live deployment.

## 1. System objective

The platform is a multi-tenant, policy-aware business discovery and enrichment system with a clean operator dashboard, durable background processing, isolated gateway paths, and controlled delivery into Codestra Middleware. Kong is the API policy enforcement plane; it is not the tenant database, workflow engine, or business system of record.

The platform is designed to onboard a tenant quickly while keeping browser, tenant API, private integration, and platform administration traffic in separate trust zones.

## 2. Non-negotiable ownership boundaries

### Kong

Kong owns edge enforcement only:

- Route segmentation.
- Request size and timeout limits.
- Correlation IDs.
- Authentication handoff.
- Consumer or credential rate limits where available.
- Source allowlists for private machine routes.
- Metrics and upstream health visibility.
- Rejection of traffic that does not match an explicit route.

Kong does not own tenant configuration, schedules, crawler state, review decisions, retry state, Odoo mappings, or n8n orchestration.

### Scraper control plane

The scraper owns:

- Tenant onboarding state.
- Tenant-scoped API clients and credential metadata.
- Source catalogs and crawl profiles.
- Recurring schedules.
- Crawl jobs, worker leases, results, evidence, and review state.
- Tenant quotas and capability flags.
- Integration endpoint metadata.
- Durable inbox/outbox status exposed to authorized operators.
- Operator-facing audit records.

### Codestra Middleware

Middleware remains the only cross-system write boundary. The scraper publishes versioned, signed, idempotent events to Middleware. Middleware owns Odoo writes, n8n trigger contracts, delivery replay, destination policy, and reconciliation across business systems.

### n8n

n8n owns orchestration, not correctness. It consumes only Middleware-approved events and sends reverse commands through the durable Middleware/scraper inbox contract.

### Odoo

Odoo receives approved projections through Middleware. Odoo is not authoritative for scraper job state, evidence provenance, tenant identity, or idempotency.

### Keycloak

Keycloak owns human and service identity. Browser users use Authorization Code with PKCE through a same-origin backend-for-frontend session. Machine clients use Client Credentials. The browser never receives a machine service credential.

## 3. Trust zones and route families

| Zone                | Host/path family                                              | Identity                                   | Default policy                                         |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Public system       | `/healthz`, `/readyz`, `/openapi.yaml`                        | None or monitoring identity                | GET only, strict limits                                |
| Dashboard/BFF       | `/console/*`, `/auth/*`, `/bff/*`                             | Keycloak user session                      | Same-origin cookie, CSRF on mutations                  |
| Tenant API          | `/api/v2/*`                                                   | Keycloak JWT or tenant service client      | Tenant-bound scopes, per-client limits                 |
| Private integration | `/integrations/v2/*`, `/api/v2/inbox/*`, `/api/v2/webhooks/*` | mTLS plus signed message or service JWT    | Private source allowlist, replay protection            |
| Platform admin      | `/platform/v2/*`                                              | Dedicated platform-admin audience and role | Separate route, smallest allowlist, no wildcard scopes |
| Kong admin/status   | never public                                                  | Local/private operations only              | Admin API disabled in DB-less runtime                  |

Each route carries an immutable trust-zone marker to the upstream. The application rejects mismatched markers so a route cannot be reached through the wrong Kong path.

## 4. Turnkey tenant onboarding

Onboarding is a durable state machine:

1. `draft` — tenant record exists but cannot run jobs.
2. `identity_pending` — Keycloak client/group provisioning requested.
3. `gateway_pending` — tenant policy and API-client metadata created.
4. `sources_pending` — source catalog or initial seed import required.
5. `integration_pending` — optional Middleware destination configured and tested with writes disabled.
6. `ready_read_only` — tenant can inspect and test without external delivery.
7. `active` — approved crawl commands enabled within quotas.
8. `suspended` — all new commands denied; reads remain available to authorized operators.
9. `decommissioning` — schedules paused and retention workflow active.
10. `decommissioned` — credentials revoked and tenant writes denied.

No onboarding step performs an undocumented side effect. Every requested external action has an idempotency key, status resource, audit event, and retry classification.

## 5. API groups

### Platform onboarding

- `POST /platform/v2/tenants`
- `GET /platform/v2/tenants`
- `GET /platform/v2/tenants/{tenantId}`
- `PATCH /platform/v2/tenants/{tenantId}`
- `POST /platform/v2/tenants/{tenantId}/activate`
- `POST /platform/v2/tenants/{tenantId}/suspend`
- `POST /platform/v2/tenants/{tenantId}/decommission`
- `GET /platform/v2/tenants/{tenantId}/onboarding`
- `POST /platform/v2/tenants/{tenantId}/onboarding/reconcile`

### API clients

- `POST /platform/v2/tenants/{tenantId}/clients`
- `GET /platform/v2/tenants/{tenantId}/clients`
- `POST /platform/v2/tenants/{tenantId}/clients/{clientId}/rotate`
- `POST /platform/v2/tenants/{tenantId}/clients/{clientId}/revoke`

A generated secret is returned once. Only a hash, key identifier, issue time, expiry, scopes, and rotation lineage are stored.

### Source catalog and schedules

- `POST /api/v2/sources`
- `GET /api/v2/sources`
- `GET /api/v2/sources/{sourceId}`
- `PATCH /api/v2/sources/{sourceId}`
- `POST /api/v2/sources/{sourceId}/validate`
- `POST /api/v2/schedules`
- `GET /api/v2/schedules`
- `GET /api/v2/schedules/{scheduleId}`
- `PATCH /api/v2/schedules/{scheduleId}`
- `POST /api/v2/schedules/{scheduleId}/pause`
- `POST /api/v2/schedules/{scheduleId}/resume`
- `POST /api/v2/schedules/{scheduleId}/run-now`

### Jobs, results, evidence, and reviews

Existing job APIs remain stable. Additional operator APIs are:

- `GET /api/v2/businesses`
- `GET /api/v2/businesses/{businessId}`
- `GET /api/v2/businesses/{businessId}/evidence`
- `GET /api/v2/reviews`
- `POST /api/v2/reviews/{reviewId}/approve`
- `POST /api/v2/reviews/{reviewId}/reject`
- `POST /api/v2/reviews/{reviewId}/merge`
- `POST /api/v2/reviews/{reviewId}/split`
- `POST /api/v2/reviews/{reviewId}/reopen`

### Integrations and delivery operations

- `POST /api/v2/integrations`
- `GET /api/v2/integrations`
- `GET /api/v2/integrations/{integrationId}`
- `PATCH /api/v2/integrations/{integrationId}`
- `POST /api/v2/integrations/{integrationId}/test`
- `POST /api/v2/integrations/{integrationId}/pause`
- `POST /api/v2/integrations/{integrationId}/resume`
- `GET /api/v2/outbox`
- `GET /api/v2/inbox`
- `GET /api/v2/dead-letters`
- `POST /api/v2/dead-letters/{messageId}/replay`

### Exports and audits

- `POST /api/v2/exports`
- `GET /api/v2/exports/{exportId}`
- `GET /api/v2/audit-events`

Exports run asynchronously and are stored only in an approved object store with tenant-scoped, expiring download authorization.

## 6. Data model

Core tables use UUID primary keys, `tenant_id`, `created_at`, `updated_at`, and an integer `version` where optimistic concurrency is required.

- `tenants`
- `tenant_onboarding_steps`
- `tenant_capabilities`
- `tenant_quotas`
- `api_clients`
- `api_client_rotations`
- `source_catalog`
- `source_validations`
- `crawl_schedules`
- `integration_endpoints`
- `integration_health_checks`
- `review_items`
- `review_decisions`
- `inbox_messages`
- `dead_letter_messages`
- `export_jobs`
- `audit_events`

Every foreign key that crosses a tenant-owned table includes the tenant key in a composite constraint. Application queries bind the tenant from the authenticated principal, never from an untrusted request header alone.

## 7. Reliability model

- API commands are idempotent.
- PostgreSQL is authoritative for command acceptance and state.
- BullMQ carries deterministic job references, not business truth.
- Workers use leases, heartbeats, and fencing tokens.
- Outbox and inbox handlers use leases and immutable message IDs.
- Retries are bounded and classified as retryable, permanent, or authorization failures.
- Dead-letter replay is an audited command and cannot change the original envelope.
- Circuit breakers protect providers and Middleware.
- Per-tenant quotas protect browsers, workers, providers, and database capacity.
- Schedules use database advisory locking or row leases so only one scheduler emits each occurrence.

## 8. Dashboard information architecture

The dashboard provides:

- Executive overview.
- Tenant onboarding wizard.
- Source catalog and source validation.
- Schedules and recurring runs.
- Crawl command center.
- Jobs and live progress.
- Business results and evidence.
- Review queue.
- Integrations and capability truth.
- Inbox, outbox, retry, and dead-letter operations.
- API clients and rotation history.
- Exports.
- Audit and diagnostics.

All visible controls are either wired to a documented API or clearly marked unavailable. There are no decorative success actions.

## 9. Kong OSS baseline and optional overlay

The baseline configuration uses only capabilities available in the selected Kong runtime and keeps application authorization authoritative. An optional overlay may add Enterprise-only identity or policy plugins, but the platform must remain secure without that overlay.

Baseline controls:

- DB-less declarative configuration.
- Admin API disabled.
- Explicit route ordering and path lists.
- No broad catch-all route.
- Correlation ID.
- Request-size limits.
- Per-zone timeouts.
- Rate limiting appropriate to each zone.
- Private IP restrictions for integration routes.
- Prometheus metrics.
- Caddy mTLS verification before Kong private routes.
- Application validation of `X-Codestra-Trust-Zone`.

## 10. Deployment topology

```text
Internet / private VLAN
        |
      Caddy
  TLS + mTLS + host policy
        |
      Kong
  route, limit, identity handoff
        |
  -------------------------------
  | dashboard-bff | api | workers |
  -------------------------------
        |        |       |
   PostgreSQL   Redis   object store
        |
  signed outbox to Codestra Middleware
        |
      n8n / Odoo / approved providers
```

Kong, the API, BFF, workers, PostgreSQL, Redis, and the dashboard use separate Docker networks. PostgreSQL and Redis have no public host ports. The dashboard can reach only the BFF. Workers cannot accept ingress traffic.

## 11. Release gates

A production release requires:

- Exact-SHA source, dashboard, contract, database, queue, gateway, and browser gates.
- Migration apply/rollback/reapply evidence.
- Immutable images by digest with SBOM and provenance.
- Read-only runtime path inventory.
- Staging with all external writes disabled.
- Tenant-isolation and authorization canaries through the real gateway.
- Duplicate-delivery and replay tests against staging Middleware/n8n/Odoo.
- No-write crawl canary.
- Exercised application rollback.
- Explicit approval naming source SHA and image digests.

## 12. Safe initial capability state

```text
ENABLE_EXTERNAL_DELIVERY=false
ENABLE_REGISTRY_ENRICHMENT=false
ENABLE_REVIEW_MUTATIONS=false
ENABLE_SCHEDULE_EXECUTION=false
ENABLE_PLATFORM_PROVISIONING=false
ODOO_WRITE=false
N8N_DELIVERY_ENABLED=false
```

The system can be reviewed, tested, and deployed read-only before any external write or recurring execution is approved.
