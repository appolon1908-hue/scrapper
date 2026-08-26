# PR #2 technical review

## Review target

- Pull request: `#2 refactor: modular production core and release gates`
- Reviewed head: `70a99ca9ea29041fa1d5cbab965dc0e400723ba0`
- Review type: model-assisted technical review of the exact source diff
- Independent human approval: **not present**

A green CI run was treated as build evidence only. It was not treated as proof of
PostgreSQL behavior, Redis behavior, migration rollback, ingress security,
staging deployment, downstream deduplication or production readiness.

## Release-critical findings

### R1 — crawl jobs could remain running after worker loss

The reviewed implementation moved a job from `queued` to `running` without a
worker lease, heartbeat or recovery deadline. A process or host failure after
that transition could leave the database job permanently `running` while
BullMQ no longer had an executable job.

**Required disposition:** add an expiring database lease, heartbeat, stale-lease
recovery and fencing of progress/finalization/failure writes.

**Disposition on release branch:** implemented and covered by real PostgreSQL
and Redis integration tests.

### R2 — outbox acknowledgement was not fenced to its claimant

An outbox event was claimed with `locked_by`, but delivery success and failure
updates matched only the event ID. After stale-lock recovery, the old worker
could race the new claimant and record a delivery or retry outcome it no longer
owned.

**Required disposition:** add an unguessable claim token and require
`event_id + worker_id + claim_token` for success/failure acknowledgement.

**Disposition on release branch:** implemented and covered by a real
PostgreSQL stale-claim test.

### R3 — queue dispatch identity permitted duplicates

Queue job IDs included time and randomness. Reconciliation and API dispatch
could therefore enqueue the same database job more than once.

**Required disposition:** derive BullMQ job identity from database job ID plus
database version.

**Disposition on release branch:** implemented and covered by a real Redis test.

### R4 — migration evidence was forward-only

The migration runner validated checksums and forward application but there was
no tested rollback path for the tenant-integrity migration or subsequent
runtime migrations.

**Required disposition:** add explicit down migrations and execute rollback plus
re-application against PostgreSQL.

**Disposition on release branch:** implemented for migrations `002` and `003`.
Migration `001` remains a destructive baseline rollback and requires snapshot
restore rather than an in-place production downgrade.

### R5 — source CI did not exercise real services

The PR ran source checks, a container build and Compose parsing, but did not run
repository and queue behavior against PostgreSQL and Redis.

**Required disposition:** add service-container integration tests for tenant
constraints, idempotency, leases, deterministic dispatch and outbox fencing.

**Disposition on release branch:** implemented.

### R6 — gateway and deployment claims required runtime evidence

The source diff did not prove Kong/Caddy routing, TLS, mTLS, allowlists, rate
limits, a write-disabled canary, immutable publication or rollback.

**Required disposition:** add executable gateway tests, immutable image
publication, a write-disabled staging workflow, a no-write canary and an
exercised rollback workflow.

**Disposition on release branch:** implementation and CI/deployment workflows
added. Actual staging and production evidence remains conditional on the
required GitHub environment secrets and an authorized staging host.

## Approval decision

`TECHNICAL_REVIEW=CHANGES_REQUIRED_ON_PR_2_SHA`

PR #2 should not be merged at its original SHA as a production release. The
correct release candidate is the descendant release branch after all findings
are fixed and its real-service, gateway, image, staging and rollback gates pass.

An independent human reviewer must approve the unchanged final release SHA.
The author or automated system must not self-approve that gate.
