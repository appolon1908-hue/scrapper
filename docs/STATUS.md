# Legacy lineage status

## Current decision

```text
REPOSITORY_ROLE=LEGACY_CURRENT_LINEAGE_PRESERVED
CANONICAL_REPOSITORY=appolon1908-hue/kyqra-crawler
LIVE_SERVER_CHANGED=NO
STAGING_DEPLOYED=NO
PRODUCTION_DEPLOYED=NO
GO_LIVE=NO_GO
```

This repository contains reconciled and tested crawler source, but it is not the canonical
production authority. The post-Gate-0 feature and deployment mission is blocked here by the
repository-identity decision in `docs/architecture/CANONICAL_REPOSITORY.md`.

## Verified preserved source

- crawl-job API, worker, PostgreSQL schema, and BullMQ queue;
- tenant-scoped service-principal authorization;
- robots and public-network URL controls;
- entity extraction and privacy-preserving EIN comparison;
- durable signed outbound delivery, disabled by default;
- renewable crawl-job leases and fenced outbox claims;
- forward migrations and rollback scripts;
- OpenAPI parity and source architecture tests; and
- gateway, image, canary, and rollback scaffolding retained for parity review.

These statements describe source only. They are not evidence of a running staging or production
service.

## Permitted next work

In this repository:

1. finish identity and stale-document cleanup;
2. preserve Gate 0 reconciliation evidence; and
3. run local and CI verification for cleanup changes.

In the canonical repository, after a source-and-contract parity review:

1. re-issue the feature and hardening mission against the accepted Kyqra baseline;
2. port selected capability source with explicit disposition evidence; and
3. execute staging, rollback, and production gates only from that canonical lineage.

The manually dispatched staging and production workflows retained here contain a mandatory
authority gate that fails before checkout, credential access, inventory, or deployment. They are
inspection evidence, not an activation path.

## Capability truth table

| Capability                        | Preserved source status          | Canonical/live status           |
| --------------------------------- | -------------------------------- | ------------------------------- |
| Crawl job API                     | implemented                      | parity review required          |
| HTTP/Playwright crawl worker      | implemented                      | parity review required          |
| Recoverable crawl leases          | integration-tested               | not proven in canonical runtime |
| Signed middleware outbox          | implemented, disabled by default | not active                      |
| n8n durable reverse-command inbox | not implemented                  | evaluate in canonical mission   |
| Odoo CRM adapter/reconciliation   | not implemented                  | evaluate in canonical mission   |
| Registry/EIN provider             | not implemented                  | evaluate in canonical mission   |
| Admin console/forms               | partial source only              | evaluate in canonical mission   |
| Production deployment             | blocked by authority gate        | not approved or executed here   |
