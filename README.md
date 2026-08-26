# Codestra Business Scrapper

A multi-tenant, policy-aware business website crawler and CRM enrichment service.

> **Deployment status:** not verified live. `main` is not the application baseline, no production deployment evidence exists, and external delivery plus registry enrichment remain disabled by default.

## Current implemented foundation

- Authenticated crawl-job API with tenant and scope enforcement
- PostgreSQL authority, idempotency, optimistic versioning and audit records
- Redis/BullMQ crawl scheduling and reconciliation
- Bounded Crawlee HTTP and Playwright execution
- robots.txt enforcement and private-network destination blocking
- Business contact extraction, evidence capture and entity merging
- Masked and keyed-fingerprint EIN comparison
- Durable outbound delivery outbox for the Codestra middleware boundary

## Source structure

```text
src/
  api/
    app.ts                  # composition root only
    routes/                 # HTTP route groups
    support/                # request/response helpers
  application/              # command orchestration
  crawler/                  # crawl execution and robots policy
  delivery/                 # middleware delivery worker
  domain/                   # extraction and entity rules
  persistence/
    repository.ts           # compatibility facade
    *-repository.ts         # focused persistence responsibilities
  security/                 # authentication, signatures and URL policy
  workers/                  # queue consumers
```

## Not implemented yet

The following are separate production workstreams, not completed features:

- Vue admin console, forms and calls to action
- Durable inbound webhook/inbox processing for n8n reverse commands
- Odoo CRM adapter, field mapping, delivery receipts and replay UI
- Kong/Caddy route configuration and deployed rate-limit policies
- Real registry/EIN provider integration
- Multi-company discovery connectors and scheduled recurring crawls
- Search/export APIs, dead-letter operations and administrative APIs
- Immutable image publication, staging canary, rollback proof and production activation

See [`docs/STATUS.md`](docs/STATUS.md) and
[`docs/architecture/PRODUCTION_STRUCTURE.md`](docs/architecture/PRODUCTION_STRUCTURE.md).

## Local verification

```bash
npm ci
npm run check
docker build -t codestra-scrapper:local .
```

The API contract is served from `/openapi.yaml` and stored at
[`openapi/openapi.yaml`](openapi/openapi.yaml).
