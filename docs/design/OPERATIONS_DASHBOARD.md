# Codestra crawler operations dashboard

## Design brief

The dashboard is an operator-facing control plane for bounded business crawl workloads. It must make job state, progress, evidence confidence, runtime health, and integration capability understandable without suggesting that unverified or disabled systems are live.

## Visual direction

- Codestra black and gold identity with restrained status colors.
- Calm typography, generous spacing, and compact high-density tables.
- Fixed desktop navigation, sticky top bar, responsive mobile navigation, and accessible detail drawers.
- No external fonts, images, scripts, analytics, or browser-embedded service credentials.
- Semantic HTML, visible keyboard focus, focus containment, and reduced-motion support.

## Information architecture

1. **Overview** — KPIs, workload distribution, recent jobs, dependency health, and capability truth.
2. **Jobs** — tenant-scoped search, status filter, sort, pagination, progress, details, cancellation, and retry.
3. **New crawl** — local CSV/JSON import, URL list, extraction profile, browser strategy, geography, optional policy fields, and explicit safety limits.
4. **Results** — normalized businesses, confidence/contact filters, evidence drawer, pagination, and browser-side CSV/JSON exports.
5. **Reviews** — disabled interaction preview until the stable review API is available.
6. **Deliveries** — pending/dead-letter visibility without implying middleware, n8n, or Odoo writes are active.
7. **Integrations** — capability truth plus non-mutating checks for the documented GET surface.
8. **Session audit** — browser-tab interaction history, clearly separated from the server audit ledger.

## Security boundary

```text
DEMO_MODE=true
WRITE_CONTROLS=false
DEVELOPMENT_TOKEN_FIELD=false
LIVE_SERVER_CHANGED=NO
```

The browser cannot turn write controls on. Production must inject policy through deployment-managed static configuration and should use a same-origin authenticated session or a PKCE/BFF boundary. Service-principal secrets are never embedded in the dashboard.

Job payloads returned to the browser are sanitized server-side: sensitive verification input and internal worker fields are omitted. Automated diagnostics never execute mutation endpoints.

## State model

Each major data source has explicit `idle`, `loading`, `ready`, and `error` states. Filtered collections have a separate empty state so “no matching records” is distinguishable from “the API failed.” Mutation buttons have per-resource pending state, destructive commands require confirmation, and server request IDs are preserved in error messages when available.

## Validation

The dashboard test suite covers:

- every documented API path and command alias;
- health, capability, and stats normalization;
- CSV/JSON imports, quoted CSV, duplicate handling, invalid rows, and the 500-company dashboard cap;
- job and result search/filter/sort behavior;
- safe job-response serialization;
- CSV escaping and browser exports;
- route, form, button, drawer, diagnostics, empty-state, and accessibility contracts;
- a real headless Chrome/Chromium workflow that clicks through the main operator journey.

See `docs/design/OPERATIONS_DASHBOARD_INTERACTION_AUDIT.md` for the interaction-to-contract matrix.

## Performance budget

- No dashboard runtime or development npm dependencies.
- No external assets.
- CSS under 100 KB plus a bounded enhancement sheet.
- Main controller and renderer under 95 KB each.
- Every route renders without an API connection in safe preview mode.
- Dashboard-specific CI validates syntax, contracts, budgets, static serving, and browser interactions.
