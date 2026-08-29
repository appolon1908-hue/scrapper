# Codestra Crawler Control

A dependency-free operations dashboard for the Codestra business crawler. It maps every control to the stable `/api/v2` contract and keeps unavailable integrations visibly disabled instead of implying that they are live.

## Implemented operator workflows

- **Overview** — normalized workload KPIs, health, readiness, capability truth, and range controls.
- **Jobs** — search, status filter, sort, clear filters, pagination, refresh, details drawer, ID copying, cancellation, and retry.
- **New crawl** — local CSV/JSON parsing, duplicate removal, invalid-row review, import preview, manual URL entry, optional include/exclude patterns, tags, callback reference, bounded limits, and idempotent submission.
- **Results** — completed-job selection, search, confidence filter, contact-state filter, pagination, evidence drawer, copy actions, and visible-view CSV/JSON exports.
- **Reviews and deliveries** — explicit unavailable or disabled states until their APIs are advertised.
- **Integrations** — capability cards plus read-only checks for all ten documented GET endpoints.
- **Session audit** — browser-tab interaction history, clearly separated from the authoritative server audit ledger.

Mutation aliases are implemented in the API client and contract-tested, but automated diagnostics never execute them. Crawl creation, cancellation, and retry require an explicit operator action.

## Safety defaults

The checked-in `config.js` starts in a non-live preview state:

```js
demoMode: true;
writeControlsEnabled: false;
allowDevelopmentToken: false;
```

The browser cannot enable writes. `writeControlsEnabled` must come from immutable deployment configuration. Production should use a same-origin authenticated session or a PKCE/BFF boundary; service-principal secrets do not belong in browser code or browser storage.

Job responses expose a safe request summary for operator context. The backend removes the `verification` block and internal worker fields before returning a job to the dashboard.

## CSV and JSON imports

Imports are parsed locally and are not uploaded as files. Accepted URL column names include:

```text
website
url
seed_url
seedurl
domain
homepage
```

JSON may be an array or an object containing `companies`, `targets`, `records`, or `items`. The dashboard:

- accepts only HTTP/HTTPS targets;
- removes exact duplicate URLs;
- reports invalid rows;
- limits the submitted view to 500 companies even when the server advertises a larger technical maximum;
- combines imported and manually entered targets without duplicating them.

## Documented API coverage

Read-only diagnostics validate:

```text
GET /
GET /healthz
GET /readyz
GET /openapi.yaml
GET /api/v2/capabilities
GET /api/v2/stats
GET /api/v2/metrics
GET /api/v2/jobs
GET /api/v2/jobs/{id}
GET /api/v2/jobs/{id}/results
```

Explicit operator commands use:

```text
POST /api/v2/jobs
POST /api/v2/commands/crawl
POST /api/v2/jobs/{id}/cancel
POST /api/v2/commands/jobs/{id}/cancel
POST /api/v2/jobs/{id}/retry
POST /api/v2/commands/jobs/{id}/retry
```

## Validate locally

No dashboard package installation is required:

```bash
npm run check
npm test
npm run serve
```

The CI workflow also opens the real dashboard in a headless Chrome/Chromium process and exercises navigation, search, filters, CSV import, form-state preservation, crawl simulation, job and result drawers, export, empty states, diagnostics, and settings.

Open `http://127.0.0.1:4173`.

## Connect to an API

Copy `config.example.js` to the deployment-managed `config.js` and set:

```js
apiBaseUrl: ''; // same origin is preferred
demoMode: false;
writeControlsEnabled: false; // keep false for read-only staging
```

Remote API base URLs require HTTPS. Connection overrides are session-scoped, and the backend remains authoritative for tenant identity and permissions.

## Production hosting

Serve these static files through the authenticated application edge. Add a restrictive CSP, frame denial, `nosniff`, a strict referrer policy, and cache rules that keep `config.js` short-lived while allowing immutable caching for versioned assets.

This package does not deploy a server, alter Kong/Caddy, enable external delivery, or claim that runtime paths have been verified.
