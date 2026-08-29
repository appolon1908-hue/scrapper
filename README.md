# scrapper

## Repository status — Stage 0 ground truth

This repository contains an active crawler/scraper development and hardening lineage, but **the repository itself does not currently provide evidence of a staging or production deployment**.

The current open release/control-plane PRs explicitly record:

```text
LIVE_SERVER_CHANGED=NO
STAGING_DEPLOYED=NO
PRODUCTION_DEPLOYED=NO
EXTERNAL_DELIVERY_ENABLED=NO
GO_LIVE=NO_GO
```

Do not infer deployment from source CI, Docker/Kong/Caddy scaffolding, or production-oriented code. A deployment claim requires reviewed runtime inventory, immutable digest evidence, write-disabled staging acceptance, canary/read-back and rollback evidence.

## Canonical crawler handoff

`appolon1908-hue/kyqra-crawler` is the canonical future Codestra/Kyqra crawler runtime authority. This repository is retained as an active development/history lineage while the existing crawler branches are reviewed and reconciled, but it must not become a second competing production crawler API, job ledger, credential set, workflow family or runtime.

The handoff is source-only until all cutover gates pass:

```text
source/contract parity
-> backup and restore proof
-> queue drain/reconciliation
-> callback cutover
-> immutable deployment
-> provider/result read-back
-> rollback rehearsal
```

## Integration boundary

```text
Client / n8n -> Kong -> Middleware -> canonical crawler runtime
                                      |
                                      +-> governed result events -> n8n/Odoo
```

Middleware remains the cross-system write/control boundary. Neither this repository nor the canonical crawler may write directly to Odoo or use n8n as a correctness store.

## Current source lineage

Production-oriented crawler, dashboard, tenant-control-plane, Keycloak, n8n inbox, Kong/Caddy and release-hardening work exists on open feature/release PRs. Those branches intentionally keep external delivery, schedule execution, provider discovery/enrichment and production deployment disabled until their separate review gates pass.
