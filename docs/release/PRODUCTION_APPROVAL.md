# Production approval record

This file is a template. It is intentionally not an approval.

## Candidate identity

- source SHA: `PENDING`
- immutable image: `PENDING`
- image digest: `PENDING`
- CI run: `PENDING`
- gateway validation run: `PENDING`
- staging evidence artifact: `PENDING`
- rollback evidence artifact: `PENDING`

## Required evidence

- [ ] Independent human review applies to the unchanged source SHA.
- [ ] Real PostgreSQL and Redis integration gates passed.
- [ ] Migration rollback and re-application passed.
- [ ] Immutable image was published with SBOM and provenance.
- [ ] Staging deployed with `ENABLE_EXTERNAL_DELIVERY=false`.
- [ ] TLS, mTLS, rate limit, request-size and allowlist validation passed.
- [ ] No-write crawl canary passed.
- [ ] n8n event and Odoo-result duplicate/replay tests passed.
- [ ] Staging rollback passed and the reviewed candidate was restored.
- [ ] Production secrets, DNS and host inventory were independently verified.

## Approval

- decision: `NO_GO`
- approver name: `PENDING`
- approver role: `PENDING`
- approved source SHA: `PENDING`
- approved image digest: `PENDING`
- maintenance window: `PENDING`
- rollback owner: `PENDING`
- timestamp: `PENDING`
- approval reference: `PENDING`

The decision may be changed to `GO` only after every checkbox is supported by
an immutable evidence reference and the approver is not approving their own
unreviewed change.
