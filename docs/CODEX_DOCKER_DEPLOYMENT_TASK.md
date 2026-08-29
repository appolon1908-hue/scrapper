# Codex Task: Docker Deployment, Admin Forms, CTAs, and Production Readiness

## Repository and starting point

Repository: `https://github.com/appolon1908-hue/scrapper`

Work from branch:

```text
ops/codex-docker-deployment
```

Expected starting commit before this task document:

```text
6f0d824cad6266f99006378f9f81f87bafba321a
```

Do not work directly on `main`. Create the implementation branch:

```text
ops/docker-production-readiness-20260826
```

Base it on `ops/codex-docker-deployment`. Keep commits small and reviewable. Push the branch and open a draft pull request back to `ops/codex-docker-deployment`.

## Current verified repository state

Treat these facts as the starting audit, but verify them yourself before changing files:

- `main` contains only the original minimal README.
- `feature/business-intelligence-pipeline`, `integration/kong-caddy-odoo-n8n`, and `hardening/security-observability` currently point to the same implementation commit.
- CI currently runs lint, typecheck, and TypeScript build, but does not run the full test suite, build the Docker image, validate Compose, or exercise the user interface.
- The Dockerfile runs `npm ci`, but the repository currently does not contain a committed `package-lock.json`.
- The Dockerfile copies `openapi`, but the repository tree currently does not contain the required `openapi/openapi.yaml` directory/file.
- The repository contains an API and workers, but no complete user-facing admin dashboard, forms, or production-tested CTA flow.
- No production deployment is proven by repository evidence. Never report the system as live until the exact deployed commit and image digest have been verified on the target host.

## Goal

Make the Codestra Business Scrapper deployable as an immutable Docker stack and provide a polished Vue 3 admin console where every form and call-to-action is connected to a real, authorized API operation.

The intended data flow is:

```text
Admin UI or n8n
    -> Caddy
    -> Kong
    -> Scrapper API
    -> PostgreSQL + Redis/BullMQ
    -> Crawl workers
    -> durable outbox
    -> Kong/Caddy middleware
    -> Odoo CRM and n8n events
```

The scrapper must never store Odoo administrator credentials and must never write directly to Odoo. Odoo writes, deduplication, campaign routing, and salesperson assignment remain authoritative middleware responsibilities.

## Non-negotiable safety and compliance rules

- Crawl only publicly accessible HTTP/HTTPS business pages supplied by an authorized user or approved discovery source.
- Respect `robots.txt`, rate limits, site terms, jurisdictional requirements, suppression records, and deletion requests.
- Do not bypass authentication, paywalls, CAPTCHAs, bot controls, or access restrictions.
- Do not crawl private, loopback, link-local, metadata, reserved, or internal network destinations.
- Do not expose PostgreSQL, Redis, browser debugging ports, the Docker socket, or internal worker ports publicly.
- Do not store raw EIN values. Preserve the existing masked/fingerprint-only design and scope checks.
- Do not put service secrets, client secrets, private keys, bearer tokens, database URLs, or Odoo credentials in Git, images, browser bundles, logs, or screenshots.
- Use Keycloak Authorization Code + PKCE for human users and service credentials for machine-to-machine clients. The canonical Keycloak host is `auth.codestra.co`.
- Use the Kong/Caddy public API edge. The browser must not call private IP addresses directly.

## Phase 1: Reproduce and repair the build

1. Record:
   - current directory;
   - branch;
   - starting SHA;
   - Node, npm, Docker, Docker Compose, and OS versions.
2. Run the current checks before modification and preserve their output.
3. Generate a deterministic `package-lock.json` using the exact dependency versions in `package.json`; commit it.
4. Add `openapi/openapi.yaml` representing all implemented endpoints, schemas, headers, authentication scopes, error responses, and examples. Validate it in CI.
5. Repair the Dockerfile so a clean build succeeds from a fresh clone using `npm ci`.
6. Do not install dependencies at runtime. Keep the runtime image non-root and read-only compatible.
7. Add a `.dockerignore` that excludes Git metadata, secrets, local storage, test reports, node_modules, and build caches.
8. Add OCI labels for repository, revision, build date, version, and source.
9. Produce a reproducible image tag and capture its immutable digest.

Required commands must succeed:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
docker build --pull --no-cache -t codestra-business-scrapper:test .
docker compose --env-file .env.staging config
```

## Phase 2: Complete and harden the API contracts

Preserve the existing `/api/v2` API and implement any missing support endpoints required by the admin UI. Do not create fake endpoints or front-end-only success messages.

Existing operations that the UI must use include:

```text
POST /api/v2/jobs
POST /api/v2/commands/crawl
GET  /api/v2/jobs
GET  /api/v2/jobs/:id
GET  /api/v2/jobs/:id/results
POST /api/v2/jobs/:id/cancel
POST /api/v2/commands/jobs/:id/cancel
POST /api/v2/jobs/:id/retry
GET  /api/v2/stats
GET  /api/v2/metrics
GET  /api/v2/capabilities
GET  /healthz
GET  /readyz
GET  /openapi.yaml
```

Add production-grade endpoints only where necessary, including:

- paginated CSV and JSON export;
- delivery/outbox status and safe replay for authorized operations users;
- suppression create/list/remove with audit history;
- integration health/test operations for middleware and n8n that do not expose secrets;
- audit-event browsing for authorized operations users;
- a dry-run validation endpoint that validates URLs and job settings without starting a crawl.

Every mutation must require:

- authenticated tenant context;
- an appropriate scope;
- `Idempotency-Key` where replay could duplicate work;
- `X-Correlation-ID`;
- bounded input size;
- structured audit logging;
- stable error codes;
- tenant-scoped database queries.

Generate typed API clients from the OpenAPI contract or maintain one authoritative typed client. Do not duplicate request/response shapes manually across the UI and API.

## Phase 3: Build the Vue 3 admin console

Create a separate frontend under:

```text
apps/admin-web
```

Use Vue 3, Vite, TypeScript, Vue Router, and a small accessible component layer. Keep the interface clean, large, responsive, and usable on mobile, tablet, laptop, and desktop.

### Authentication

- Use Keycloak Authorization Code + PKCE.
- Do not include a browser client secret.
- Do not store bearer tokens in localStorage.
- Implement protected routes, session expiry, refresh/re-authentication, logout, and unauthorized states.
- Derive visible actions from scopes for UX, while keeping the backend authoritative.

### Required pages

1. **Overview**
   - queue status;
   - completed/failed/running totals;
   - result and delivery totals;
   - recent errors;
   - worker readiness.
2. **New Crawl Job**
   - URLs textarea;
   - CSV/JSON import;
   - maximum companies, constrained to 1-500;
   - maximum pages and depth within API capability limits;
   - crawl profile;
   - include/exclude patterns;
   - request rate;
   - optional authorized verification settings;
   - dry-run validation results;
   - clear consent/compliance acknowledgement.
3. **Jobs**
   - filter, search, status, pagination, and date range;
   - open job details;
   - cancel and retry where allowed.
4. **Job Details**
   - progress;
   - source URLs;
   - result quality/confidence;
   - field-level provenance;
   - conflicts and review flags;
   - delivery status;
   - audit events.
5. **Results**
   - business name;
   - website;
   - public business email;
   - public business phone;
   - address/location text;
   - owner/executive candidate with source and confidence;
   - masked EIN match status, never raw EIN;
   - CSV/JSON export.
6. **CRM Delivery**
   - queued, delivered, retrying, and dead-letter records;
   - authorized replay;
   - middleware response and Odoo external reference where returned.
7. **Suppressions and Privacy**
   - add/list/remove suppressions;
   - deletion workflow;
   - audit history.
8. **Integrations**
   - Kong/Caddy route status;
   - middleware readiness;
   - n8n signed-command test;
   - Odoo connectivity status as reported by middleware, never by direct Odoo access.
9. **Operations**
   - health, readiness, queue counts, worker status, and recent bounded logs/events.

### Required forms and CTAs

Every CTA must call a real API, show loading state, prevent duplicate submission, display the correlation ID, and present a meaningful success or error state.

Required CTAs:

```text
Validate URLs
Import CSV
Import JSON
Save Draft locally without secrets
Start Crawl
Cancel Job
Retry Job
Refresh Status
Export CSV
Export JSON
Queue CRM Delivery
Replay Failed Delivery
Add Suppression
Remove Suppression
Request Deletion
Test Middleware
Test n8n Command
Copy Job ID
Copy Correlation ID
Sign Out
```

Rules:

- No `href="#"`, empty handlers, console-only handlers, placeholder modals, fake success toasts, or hard-coded sample responses.
- Disable actions the user lacks permission to perform.
- Confirm destructive actions.
- Generate a UUID correlation ID per command and a stable idempotency key per intentional submission.
- Preserve the idempotency key across network retries.
- Validate client-side for usability and server-side for authority.
- Add accessible labels, keyboard navigation, focus management, error summaries, and responsive layouts.
- Add Playwright end-to-end tests proving each form and CTA calls the expected route and handles success, validation failure, authorization failure, network timeout, duplicate submission, and server error.

## Phase 4: n8n reverse-order command flow

Implement and document an authenticated n8n-to-scrapper command path through Kong/Caddy.

Requirements:

- service principal or signed HMAC command contract;
- timestamp and replay-window enforcement;
- unique event ID/inbox deduplication;
- tenant binding;
- `Idempotency-Key` and `X-Correlation-ID` propagation;
- maximum 500 companies per job;
- request and result schemas in OpenAPI;
- an inactive n8n workflow template committed for review;
- no workflow activation until the staging canary passes.

The return path must publish job progress, completion, failure, and middleware/Odoo delivery outcomes through the durable outbox. It must tolerate duplicate and out-of-order events.

## Phase 5: Kong, Caddy, and middleware configuration

Add reviewed templates under `deploy/` for staging and production. Do not overwrite active host configuration until validation succeeds.

Expected public routing pattern:

```text
Caddy TLS -> Kong -> scrapper-api:3000
```

Use a stable external prefix such as:

```text
/v1/scrapper/
```

Map it deliberately to `/api/v2/` and document whether the prefix is stripped. Preserve `/healthz` and `/readyz` as private or tightly limited probes.

Configure:

- TLS and, for private service-to-service paths, mTLS;
- OIDC/JWT validation at Kong and authoritative scope/tenant validation in the API;
- request-size limits;
- per-client and per-tenant rate limits;
- correlation-ID propagation;
- timeouts appropriate for command submission, never for the full crawl duration;
- no buffering of large exports where streaming is supported;
- CORS restricted to the approved admin UI origin;
- security headers;
- redacted access logs.

The delivery worker must call only an allowlisted middleware host through Kong/Caddy using signed requests and idempotent event IDs. Odoo remains inaccessible from the browser and crawl worker.

## Phase 6: Docker Compose and host hardening

Provide separate staging and production examples without committing secrets.

The stack must include:

```text
admin-web
api
crawl-worker
delivery-worker
migrate
postgres
redis
```

Requirements:

- pin all images by immutable digest for production;
- non-root runtime users;
- read-only filesystems where possible;
- drop all Linux capabilities;
- `no-new-privileges`;
- bounded memory and CPU;
- health checks;
- persistent named volumes for PostgreSQL and Redis;
- internal-only database/cache network;
- no Docker socket mount;
- secret files mounted read-only;
- log rotation;
- restart policies that do not restart one-shot migrations forever;
- graceful shutdown and worker lease recovery;
- crawl-worker egress blocked from Codestra private VLANs and metadata IPs at the host firewall;
- delivery-worker egress restricted to the approved middleware destination where practical.

Do not expose ports 5432 or 6379. Bind the API and admin web locally behind Caddy/Kong unless the approved network design requires otherwise.

## Phase 7: CI and release gates

Expand `.github/workflows/ci.yml` to include:

```text
npm ci
format check
lint
typecheck
unit tests
integration tests
security/SSRF tests
OpenAPI validation
admin UI build
admin UI unit tests
Playwright CTA/form tests
Docker image build
Docker Compose config validation
secret scan
dependency audit
container vulnerability scan
SBOM generation
```

Use pinned action SHAs where feasible. Do not publish or deploy from untrusted pull-request code.

Add a separate manually approved release workflow that:

- builds from an exact reviewed commit;
- tags the image with version and commit SHA;
- records the digest;
- generates SBOM and provenance;
- signs the exact digest;
- deploys staging first;
- requires an environment approval before production;
- verifies the deployed digest after rollout;
- supports rollback to the previously recorded digest.

## Phase 8: Staging deployment procedure

Do not assume the target server. First inventory the host and record:

```bash
hostname
hostname -I
uname -a
docker version
docker compose version
df -h
free -h
ss -lntup
docker ps -a
```

Confirm the approved staging directory, domain, DNS, Caddy instance, Kong route, firewall policy, secret locations, and backup destination.

Then:

1. Back up the existing deployment and database.
2. Clone or fetch the repository.
3. Check out the exact approved SHA.
4. Verify a clean working tree.
5. Build and scan the image.
6. Record the digest.
7. Run `docker compose config`.
8. Start PostgreSQL and Redis.
9. Run migrations once.
10. Start API and admin web only.
11. Verify readiness locally and through Caddy/Kong.
12. Start one crawl worker.
13. Keep external CRM delivery disabled.
14. Run a 5-company canary using owned/test domains.
15. Confirm results, provenance, cancellation, retry, exports, UI forms, and every CTA.
16. Enable one delivery worker against staging middleware only.
17. Confirm duplicate delivery does not duplicate an Odoo lead/company.
18. Run a bounded 500-company staging soak.
19. Kill and restart a worker to prove lease recovery.
20. Produce the evidence report.

Never use unrelated public websites for a load test. Use authorized fixtures, owned domains, or controlled test pages.

## Phase 9: Production deployment gate

Production deployment is allowed only when all of the following are true:

- pull request reviewed and merged to the approved release branch;
- all CI checks green on the unchanged release SHA;
- Docker image built, scanned, signed, and referenced by digest;
- staging canary and 500-company soak pass;
- all admin forms and CTAs pass Playwright tests;
- Kong/Caddy routing and authentication pass;
- n8n replay protection passes;
- middleware idempotency and Odoo deduplication pass;
- backups and rollback are verified;
- exact production host and maintenance window are approved;
- secrets exist with correct ownership and permissions;
- a human approves the production environment deployment.

Deploy the exact staging-tested digest. After rollout verify:

```text
public/admin URL
healthz
readyz
API version
Git commit SHA
container image digest
Kong route
Caddy TLS
worker readiness
one authorized production canary
Odoo external reference returned through middleware
n8n outcome event
```

If any check fails, roll back to the previously recorded digest and report `PRODUCTION_DEPLOYMENT=ROLLED_BACK`.

## Required rollback procedure

Before deployment, record the current image digest and Compose/config revision. Rollback must:

1. stop new crawl command acceptance or place the API in maintenance mode;
2. stop crawl and delivery workers gracefully;
3. restore the prior image digest and config;
4. avoid reversing forward-compatible database migrations unless a tested down migration exists;
5. restart services;
6. verify readiness and prior functionality;
7. preserve failed job/outbox evidence for investigation.

## Required final report

Do not say “done,” “pushed,” or “live” without evidence. Produce a final report containing:

```text
CURRENT_DIRECTORY=
STARTING_BRANCH=
STARTING_SHA=
IMPLEMENTATION_BRANCH=
FINAL_SHA=
PUSHED_TO_GITHUB=YES|NO
DRAFT_PR_URL=
CI_STATUS=
TEST_TOTAL=
TEST_FAILURES=
DOCKER_BUILD=PASS|FAIL
COMPOSE_CONFIG=PASS|FAIL
IMAGE_REFERENCE=
IMAGE_DIGEST=
SBOM=
SIGNATURE_VERIFIED=YES|NO
STAGING_DEPLOYED=YES|NO
STAGING_URL=
STAGING_CANARY=PASS|FAIL|NOT_RUN
FIVE_HUNDRED_COMPANY_SOAK=PASS|FAIL|NOT_RUN
ALL_FORMS_TESTED=YES|NO
ALL_CTAS_CONNECTED=YES|NO
KONG_ROUTE=PASS|FAIL|NOT_CONFIGURED
CADDY_TLS=PASS|FAIL|NOT_CONFIGURED
N8N_REVERSE_FLOW=PASS|FAIL|NOT_CONFIGURED
MIDDLEWARE_DELIVERY=PASS|FAIL|DISABLED
ODOO_DEDUPLICATION=PASS|FAIL|NOT_TESTED
PRODUCTION_DEPLOYED=YES|NO
PRODUCTION_URL=
DEPLOYED_SHA=
DEPLOYED_IMAGE_DIGEST=
ROLLBACK_DIGEST=
RELEASE_GO_NO_GO=GO|NO_GO
BLOCKERS=
```

Attach or link the relevant test logs, workflow run, pull request, image digest, Compose validation, smoke-test output, screenshots of the responsive admin forms, and rollback evidence.

## Stop conditions

Stop without deploying production and report `RELEASE_GO_NO_GO=NO_GO` when:

- the target host is ambiguous;
- the Docker build is not reproducible;
- the release SHA moved after review;
- required secrets are missing;
- any CTA is fake or unconnected;
- tests are failing or incomplete;
- private-network egress controls are unproven;
- middleware/Odoo idempotency is unproven;
- rollback cannot be demonstrated;
- the deployed image digest cannot be matched to the approved commit.
