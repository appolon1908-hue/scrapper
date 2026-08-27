# Codestra Crawler Control

A dependency-free operations dashboard for the Codestra business crawler. It presents the stable API honestly: job commands and results work against the documented `/api/v2` contract, while reviews, direct Odoo projection, n8n reverse commands, authoritative EIN verification, and runtime deployment are shown as unavailable until capability evidence exists.

## Safety defaults

The checked-in `config.js` starts in a non-live preview state:

```js
demoMode: true;
writeControlsEnabled: false;
allowDevelopmentToken: false;
```

The UI never enables writes from a browser toggle. `writeControlsEnabled` must come from immutable deployment configuration. A production installation should use a same-origin authenticated session or a PKCE/BFF boundary; service-principal secrets do not belong in browser code.

## Dashboard areas

- **Overview** — workload KPIs, pipeline mix, recent jobs, health, and capability truth.
- **Jobs** — tenant-scoped search, status filters, progress, job drawer, cancellation, and retry.
- **New crawl** — bounded command form with URL, profile, browser, country, depth, rate, and company limits.
- **Results** — normalized business records with confidence and a browser JSON export.
- **Reviews** — interaction preview, visibly disabled until a durable review API is advertised.
- **Deliveries** — middleware/Odoo/n8n truth without implying external writes are enabled.
- **Integrations** — current capability and runtime contract.
- **Session audit** — local interaction history, explicitly not the authoritative server audit ledger.

## Run locally

No package installation is required.

```bash
npm run check
npm test
npm run serve
```

Open `http://127.0.0.1:4173`.

## Connect to an API

Copy `config.example.js` to the deployment-managed `config.js` and set:

```js
apiBaseUrl: ''; // same origin is preferred
demoMode: false;
writeControlsEnabled: false; // keep false for read-only staging
```

The dashboard calls only the stable endpoints documented in `openapi/openapi.yaml`:

- `GET /healthz`
- `GET /readyz`
- `GET /api/v2/capabilities`
- `GET /api/v2/stats`
- `GET|POST /api/v2/jobs`
- `GET /api/v2/jobs/{id}`
- `POST /api/v2/jobs/{id}/cancel`
- `POST /api/v2/jobs/{id}/retry`
- `GET /api/v2/jobs/{id}/results`

## Production hosting

Serve these static files through the authenticated application edge. Add server-side headers appropriate to the deployment, including CSP, frame denial, no-sniff, a strict referrer policy, and cache rules that keep `config.js` short-lived while allowing immutable caching for versioned assets.

This package does not deploy a server, alter Kong/Caddy, enable external delivery, or claim that runtime paths have been verified.
