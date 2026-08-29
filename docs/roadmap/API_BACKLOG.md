# API and feature backlog

These APIs are intentionally **not** represented as implemented in OpenAPI.

## Admin, search and export

- `GET /api/v2/businesses`
- `GET /api/v2/businesses/{id}`
- `GET /api/v2/businesses/{id}/evidence`
- `POST /api/v2/exports`
- `GET /api/v2/exports/{id}`
- `GET /api/v2/audit-events`
- `GET /api/v2/outbox`
- `POST /api/v2/outbox/{id}/replay`
- `POST /api/v2/jobs/bulk-cancel`
- `POST /api/v2/jobs/{id}/pause`
- `POST /api/v2/jobs/{id}/resume`

Required controls: tenant filters in every query, cursor pagination, export
authorization, field-level PII policy, audit events and asynchronous exports.

## n8n reverse commands and webhooks

- `POST /api/v2/inbox/n8n/commands`
- `GET /api/v2/inbox/{messageId}`
- `POST /api/v2/inbox/{messageId}/replay`
- `POST /api/v2/webhooks/n8n/results`

Required controls: HMAC or mTLS verification, timestamp tolerance, nonce and
idempotency enforcement, durable inbox records, state-machine validation,
dead-letter handling and replay audit.

## Odoo projection

- outbound customer/lead/company upsert adapter
- field mapping version and provenance
- delivery receipts and Odoo external identifiers
- conflict policy that keeps the scraper database authoritative
- replay and reconciliation operations

Odoo is a CRM projection target. It must not become the authority for crawler
job state or idempotency.

## Discovery and registry providers

- source catalog and per-source policy
- scheduled crawls and recurring jobs
- discovery seeds, sitemaps and approved directory connectors
- provider adapter for registry/EIN verification
- consent reference, purpose, retention and provider-response provenance
- provider rate limits, circuit breakers and cost budgets

## Admin console

- Vue application with authenticated job creation
- jobs table, progress, cancellation and retry
- business search, evidence drawer and export flow
- outbox/dead-letter operations
- integration health and capability truth
- no button may claim success until the corresponding API response is confirmed
