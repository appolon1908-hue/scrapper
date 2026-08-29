# Codestra Business Scrapper

A multi-tenant, policy-aware business website crawler and CRM enrichment service.

> **Deployment status:** not verified live. The application source is reconciled by Gate 0, but no staging or production deployment evidence exists, and external delivery plus registry enrichment remain disabled by default.

## Repository and deployment truth

Source CI, Docker/Kong/Caddy scaffolding, and production-oriented code are not deployment evidence. The current release state is:

```text
LIVE_SERVER_CHANGED=NO
STAGING_DEPLOYED=NO
PRODUCTION_DEPLOYED=NO
EXTERNAL_DELIVERY_ENABLED=NO
GO_LIVE=NO_GO
```

A deployment claim requires reviewed runtime inventory, immutable image-digest evidence, write-disabled staging acceptance, canary/read-back logs, and a rehearsed rollback.

## Current implemented foundation

- Authenticated crawl-job API with tenant and scope enforcement
- PostgreSQL authority, idempotency, optimistic versioning and audit records
- Redis/BullMQ crawl scheduling and reconciliation
- Bounded Crawlee HTTP and Playwright execution
- robots.txt enforcement, domain-policy enforcement, and private-network destination blocking
- Business contact extraction, evidence capture and entity merging
- Typed CSV/JSON seed ingestion and normalized discovery candidates
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
  discovery/                # seed import and discovery normalization
  domain/                   # extraction and entity rules
  persistence/
    repository.ts           # compatibility facade
    *-repository.ts         # focused persistence responsibilities
  security/                 # authentication, signatures and URL policy
  workers/                  # queue consumers
```

## Not implemented yet

The following are separate production workstreams, not completed features:

- Fully accepted admin-console workflows and calls to action
- Durable inbound webhook/inbox processing for n8n reverse commands
- Odoo CRM adapter, field mapping, delivery receipts and replay UI
- Deployed Kong/Caddy rate-limit and mTLS policies
- Real registry/EIN provider integration
- Licensed search connectors and scheduled recurring crawls
- Production-grade proxy, authentication, extraction-resilience, and observability tiers
- Immutable image publication, staging canary, rollback proof and production activation

See [`docs/STATUS.md`](docs/STATUS.md),
[`docs/architecture/PRODUCTION_STRUCTURE.md`](docs/architecture/PRODUCTION_STRUCTURE.md), and
[`docs/evidence/P0/GATE.md`](docs/evidence/P0/GATE.md).

## Canonical crawler handoff

`appolon1908-hue/kyqra-crawler` is the future Codestra/Kyqra crawler runtime authority. This repository remains the active implementation lineage until Phase 10 and must not become a competing production API, job ledger, credential set, workflow family, or runtime.

The handoff stays source-only until every cutover gate passes:

```text
source/contract parity
-> backup and restore proof
-> queue drain/reconciliation
-> callback cutover
-> immutable deployment
-> provider/result read-back
-> rollback rehearsal
```

The integration boundary is:

```text
Client / n8n -> Kong -> Middleware -> canonical crawler runtime
                                      |
                                      +-> governed result events -> n8n/Odoo
```

Middleware remains the cross-system write/control boundary. Neither crawler repository may write directly to Odoo or use n8n as a correctness store.

## Local verification

```bash
npm ci
npm run check
npm run test:integration
docker build -t codestra-scrapper:local .
```

The API contract is served from `/openapi.yaml` and stored at
[`openapi/openapi.yaml`](openapi/openapi.yaml).
