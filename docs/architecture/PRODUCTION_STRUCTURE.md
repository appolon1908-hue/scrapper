# Production structure

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

## Branch boundaries

Heavy capabilities must remain independent review branches based on the modular
core:

1. `refactor/modular-production-core`
2. `feature/admin-search-export-api`
3. `integration/n8n-durable-inbox-webhooks`
4. `integration/odoo-crm-projection`
5. `feature/discovery-registry-connectors`
6. `feature/vue-admin-console`
7. `hardening/kong-caddy-release-controls`

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
