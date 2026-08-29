# Preserved production-oriented source structure

This document describes source boundaries retained for parity review. It is not a deployment
plan: `appolon1908-hue/kyqra-crawler` is the canonical crawler authority, and this legacy
repository cannot be activated as a competing runtime.

## Dependency direction

```text
HTTP routes
    ↓
application services
    ↓
domain rules
    ↓
persistence / queue / delivery adapters
```

The API composition root must not contain business workflows or SQL. Route
modules validate transport input and enforce scopes. Application services own
command orchestration. Domain modules remain independent of Fastify, PostgreSQL
and BullMQ. Persistence modules are grouped by responsibility behind the
`Repository` compatibility facade.

## Review boundaries

If a parity review selects capability source for migration, keep these responsibilities in
independent changes in the canonical repository:

1. modular crawler core;
2. admin, search, and export API;
3. durable n8n inbox and webhook handling;
4. Odoo CRM projection;
5. discovery and registry connectors;
6. admin console; and
7. gateway and release controls.

Do not combine UI, reverse webhooks, Odoo mapping, discovery providers and
production activation in one pull request.

## API rules

- `/api/v2/jobs/*` is the resource surface.
- `/api/v2/commands/*` contains explicit command aliases.
- All state-changing calls require `x-correlation-id`.
- Job creation also requires `idempotency-key`.
- Tenant authority comes from the authenticated principal; `x-tenant-id` is
  optional and must match that authority when present.
- Every implemented route must exist in `openapi/openapi.yaml`.
- Disabled or unimplemented capabilities must be reported as false rather than
  implied by documentation.

## Release rules

No branch name, README text, green compile, or Dockerfile is proof of a live
deployment. Production requires an immutable image digest, a reviewed manifest,
staging evidence, rollback proof and explicit approval.

Those release gates belong to `appolon1908-hue/kyqra-crawler`. Deployment workflows retained
in this repository are blocked and exist only as source evidence for the parity review.
