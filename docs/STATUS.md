# Delivery status

## Current decision

`GO_LIVE=NO_GO`

The release branch contains code and automated evidence gates. It is not, by
itself, proof that a remote staging or production host is running the service.
Production remains blocked until branch protection, independent approval,
remote staging evidence and a digest-bound production authorization all exist.

## Verified or enforced in source

- crawl-job API, worker, PostgreSQL schema and BullMQ queue
- tenant-scoped service-principal authorization
- robots and public-network URL controls
- entity extraction and privacy-preserving EIN comparison
- durable signed outbound delivery, disabled by default
- renewable and recoverable crawl-job leases
- fenced outbox claims and acknowledgements
- deterministic queue dispatch by database version
- forward migrations and rollback scripts
- modular API and persistence boundaries
- OpenAPI source contract and unit/architecture tests
- CI definitions using real PostgreSQL 17 and Redis 7.4 services
- Caddy/Kong TLS, mTLS, allowlist, rate-limit and request-size validation stack
- immutable GHCR publication, signing, SBOM/provenance and vulnerability gates
- no-write staging canary and application/schema rollback rehearsal

## Independent review status

A technical review identified two release-critical defects in PR #2:

1. crawl workers had no recoverable execution lease;
2. outbox acknowledgements were not fenced to the active claimant.

The release branch contains fixes and tests for both findings. This review was
performed by the implementation assistant and is **not** a substitute for an
independent human approval. One approving review from a different reviewer is
required by the intended release-branch protection policy.

## Required before a remote staging deployment

1. CI must pass on the unchanged release SHA.
2. `release/production-readiness-20260826` must be protected.
3. The image must be published and referenced by digest.
4. Staging SSH, URL, environment and secret files must be configured outside Git.
5. Staging must start with `ENABLE_EXTERNAL_DELIVERY=false`.
6. The remote readiness check and no-write canary must pass.

## Required before production

1. Independent human review of the unchanged release SHA.
2. All review conversations resolved.
3. Green release, gateway, image, staging and rollback evidence.
4. A production environment approval in GitHub.
5. Exact manual approval text bound to the published digest.
6. Production SSH, URL, environment and secret files configured outside Git.
7. A pre-deployment PostgreSQL backup.
8. Successful local and external readiness checks.
9. External delivery kept disabled until actual n8n/Odoo receivers pass their
   own authentication, duplicate-delivery, replay and rollback acceptance tests.

## Capability truth table

| Capability                         | Source status                                       | Remote live status                 |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------- |
| Crawl job API                      | implemented                                         | not yet proven by release evidence |
| HTTP/Playwright crawl worker       | implemented                                         | not yet proven by release evidence |
| Recoverable crawl leases           | implemented and integration-tested by CI definition | not yet proven remotely            |
| Signed middleware outbox           | implemented, disabled by default                    | not active                         |
| Simulated n8n/Odoo replay contract | implemented as deterministic integration test       | not a live integration             |
| n8n durable reverse-command inbox  | not implemented                                     | not live                           |
| Odoo CRM adapter/reconciliation    | not implemented                                     | not live                           |
| Registry/EIN provider              | not implemented                                     | not live                           |
| Vue admin console/forms            | not implemented                                     | not live                           |
| Kong/Caddy validation stack        | implemented                                         | remote routing not yet proven      |
| Immutable image release            | automated after protection and green gates          | pending evidence                   |
| Production deployment              | guarded workflow implemented                        | not approved or executed           |
