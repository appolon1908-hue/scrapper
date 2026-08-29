# Scrapper to Kyqra canonical runtime handoff

## Decision

This repository remains preserved as historical/current-lineage evidence. New Codestra crawler integration-fabric implementation is authoritative in:

```text
appolon1908-hue/kyqra-crawler
branch: integration/codestra-crawler-fabric-v2
```

No source, branch, deployment, data or runtime is deleted by this handoff.

## Rules

- Do not implement a second competing Middleware API, n8n workflow family, provider credential set, job ledger or production deployment here.
- Existing hardening and open PR evidence remains valid for its exact lineage.
- A migration may copy accepted functionality only after a file/contract/runtime parity review.
- Production authority moves only through a separately approved migration with backup, restore, immutable images, endpoint cutover, callback cutover, queue drain, read-back, rollback and DNS/network verification.
- Until that migration, neither repository is silently declared deployed from source state alone.

## Safety

```text
LEGACY_REPOSITORY_DELETED=NO
BRANCHES_REWRITTEN=NO
RUNTIME_CUTOVER=NO
CRAWLER_STARTED=NO
ODOO_WRITEBACK=NO
PRODUCTION_CHANGED=NO
```
