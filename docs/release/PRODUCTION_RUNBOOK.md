# Production release runbook

## Safety defaults

The first staging and production deployment must use:

```dotenv
ENABLE_EXTERNAL_DELIVERY=false
ENABLE_REGISTRY_ENRICHMENT=false
```

These values keep Odoo, n8n and registry/provider side effects disabled. They
must not be changed merely because source CI is green.

## Required lineage

1. Review and merge the runtime-correction branch into PR #2's head branch.
2. Rerun PR #2 checks on the resulting unchanged SHA.
3. Obtain an approving review from a different human reviewer.
4. Merge the reviewed lineage through the agreed protected branch; do not
   bypass the pull-request requirement.
5. Record the resulting release SHA.

## Release image

The release-readiness workflow:

- builds from the protected release SHA;
- publishes one SHA tag to GHCR;
- records the immutable `@sha256:` reference;
- creates an SBOM/provenance attestation;
- signs the digest using GitHub OIDC;
- rejects fixed HIGH/CRITICAL vulnerabilities;
- uploads an image-identity evidence artifact.

Deploy only the immutable reference. A mutable tag is never an acceptable
deployment input.

## Staging prerequisites

Configure these Actions secrets:

- `SCRAPPER_STAGING_HOST`
- `SCRAPPER_STAGING_USER`
- `SCRAPPER_STAGING_SSH_KEY`
- `SCRAPPER_STAGING_PATH`
- `SCRAPPER_STAGING_URL`

Provision on the staging host:

- `/etc/codestra/scrapper/staging.env`
- `/etc/codestra/scrapper/secrets/database_url`
- `/etc/codestra/scrapper/secrets/postgres_password`
- `/etc/codestra/scrapper/secrets/service_principals.json`
- `/etc/codestra/scrapper/secrets/ein_fingerprint_pepper`
- disabled placeholder or staging-only middleware mTLS/signing files

The staging environment file must contain
`ENABLE_EXTERNAL_DELIVERY=false`.

## Staging acceptance

- immutable image pulled successfully;
- migrations applied;
- `/readyz` succeeds;
- capabilities report external delivery and registry enrichment disabled;
- a one-page crawl completes;
- outbox events remain `pending` with zero delivery attempts;
- Caddy/Kong TLS 1.3, mTLS, allowlist, rate limit and request-size tests pass;
- migration rollback permits the previous application image to become ready;
- the current image and migration can be restored.

## Production approval

After release and staging evidence is reviewed, manually run **Production
deployment** from the protected release branch with:

- the reviewed 40-character release SHA;
- the exact published `sha256:` digest;
- approval text exactly equal to `DEPLOY <sha256:digest>`.

The GitHub `production` environment should require an independent reviewer.
The workflow also confirms that the release branch is protected and that the
image revision label, signature and GitHub attestation match the requested SHA.

## Production host prerequisites

Configure:

- `SCRAPPER_PRODUCTION_HOST`
- `SCRAPPER_PRODUCTION_USER`
- `SCRAPPER_PRODUCTION_SSH_KEY`
- `SCRAPPER_PRODUCTION_PATH`
- `SCRAPPER_PRODUCTION_URL`

Provision the production environment and secret files under
`/etc/codestra/scrapper/`. The production environment must initially retain
`ENABLE_EXTERNAL_DELIVERY=false`.

## Deployment and rollback

The production workflow:

1. records the previous image;
2. pulls the approved digest;
3. starts PostgreSQL and Redis;
4. creates a PostgreSQL custom-format backup;
5. applies migrations;
6. starts API and workers;
7. checks local readiness;
8. on failure, stops the release, rolls back the latest migration and restores
   the previous image when one exists;
9. records deployment evidence.

Database restore from the pre-deployment backup remains an explicit operator
action; it must not be performed automatically over potentially valid writes.

## External-delivery activation

Activation is a later change, not part of the initial production deployment.
Before changing `ENABLE_EXTERNAL_DELIVERY=true`, prove against the actual
receivers:

- mTLS and HMAC authentication;
- timestamp and replay-window enforcement;
- duplicate delivery produces one downstream side effect;
- timeout-after-success reconciliation;
- Odoo mapping and conflict policy;
- n8n durable inbox and dead-letter behavior;
- suppression, retention and audit controls;
- exercised rollback.

Record a separate digest-bound approval for that activation.
