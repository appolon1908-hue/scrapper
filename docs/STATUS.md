# Delivery status

## Current decision

`GO_LIVE=NO_GO`

This repository contains a reviewable runtime foundation. It is **not** evidence
that the service is running on a server or reachable through Kong/Caddy.

## Verified in source

- crawl-job API, worker, PostgreSQL schema and BullMQ queue
- tenant-scoped service-principal authorization
- robots and public-network URL controls
- entity extraction and privacy-preserving EIN comparison
- outbound outbox with signed middleware delivery
- modular API and persistence boundaries
- OpenAPI source contract and unit/architecture tests

## Required before a server deployment

1. Merge the application lineage into an agreed protected release branch.
2. Commit and verify the npm lockfile.
3. Pass lint, typecheck, tests, formatting, Docker build and Compose validation.
4. Implement and test the Kong/Caddy routes outside the application repository.
5. Provision PostgreSQL, Redis, secrets, mTLS material and allowlists.
6. Keep `ENABLE_EXTERNAL_DELIVERY=false` for the first staging deployment.
7. Run migrations, readiness checks and a no-write crawl canary.
8. Enable middleware delivery only after signed request and replay tests pass.
9. Capture immutable image digest, deployment manifest and rollback evidence.
10. Obtain an explicit production approval.

## Capability truth table

| Capability | Source status | Live status |
|---|---|---|
| Crawl job API | implemented | not verified |
| HTTP/Playwright crawl worker | implemented | not verified |
| Outbound middleware outbox | implemented, disabled by default | not verified |
| n8n reverse-command inbox | not implemented | not live |
| Odoo CRM adapter | not implemented | not live |
| Registry/EIN provider | not implemented | not live |
| Vue admin console/forms | not implemented | not live |
| Kong/Caddy routes | external configuration required | not verified |
| Production deployment | no evidence | not live |
