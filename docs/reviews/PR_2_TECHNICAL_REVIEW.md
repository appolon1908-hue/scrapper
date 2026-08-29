# PR #2 technical review

## Scope

Reviewed pull request #2 at its original head
`70a99ca9ea29041fa1d5cbab965dc0e400723ba0`, including the API, PostgreSQL
persistence, BullMQ scheduling, crawler lifecycle, durable outbox, migrations,
container and CI definitions.

This is an implementation-assisted technical review. It is not an independent
human approval and must not be represented as one.

## Release-critical finding 1: unrecoverable crawl execution

### Original behavior

The worker changed a database job from `queued` to `running`, but the row did
not record a worker identity, run token, heartbeat or lease expiration. A
process or host failure after that transition could leave the authoritative job
permanently `running`. BullMQ and PostgreSQL could then disagree about whether
the work was available.

### Required correction

- database-authoritative run token and worker identity;
- renewable heartbeat and lease expiration;
- periodic recovery of expired leases;
- deterministic queue dispatch using the database version;
- stale-worker fencing on progress, completion and failure;
- migration handling for pre-existing `running` rows.

### Applied release-branch correction

Migration `003_runtime_leases.sql`, `JobRepository`, `runCrawlJob`, the crawl
worker and queue adapter implement the required model. The real PostgreSQL and
Redis integration test covers exclusive claim, lease expiry, requeue, stale
worker rejection and deterministic queue dispatch.

## Release-critical finding 2: unfenced outbox acknowledgement

### Original behavior

A stale delivery worker could complete its HTTP request after its database lock
had expired and another worker had reclaimed the event. The stale worker could
then mark the event delivered or failed without proving it still owned the
claim.

### Required correction

- random lock token recorded with every claimed batch;
- delivery/failure acknowledgement conditional on worker ID and lock token;
- stale-lock recovery that clears the token;
- downstream idempotency retained because HTTP side effects cannot be rolled
  back after a timeout or worker race.

### Applied release-branch correction

Migration `003_runtime_leases.sql`, `OutboxRepository` and the delivery worker
implement lock-token fencing. Integration tests cover stale claimant rejection
and signed duplicate/replay handling for deterministic n8n- and Odoo-shaped
receivers.

## Additional review corrections

- added forward and down migrations with serialized advisory locking;
- added a dedicated production-safe migration role;
- separated normal unit tests from tests requiring PostgreSQL/Redis;
- added real PostgreSQL 17 and Redis 7.4 CI services;
- added migration rollback/reapply and full disposable-schema tests;
- added TLS 1.3, mTLS, allowlist, rate-limit and request-size gateway tests;
- added signed, attested, digest-only image publication;
- added no-write staging canary and rollback rehearsal;
- added digest-bound production deployment approval.

## Remaining blockers

- approval by a different human reviewer;
- protected release branch confirmed on GitHub;
- green checks on the unchanged final SHA;
- configured remote staging host, ingress, DNS and secrets;
- actual n8n reverse-command inbox and actual Odoo CRM adapter;
- remote staging and production evidence;
- explicit production approval bound to the released digest.

## Review disposition

`CHANGES_REQUIRED` for the original PR #2 head.

The release branch contains the proposed corrections. Its final SHA requires a
fresh independent review after all automated evidence is green.
