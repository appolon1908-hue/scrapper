# Codestra crawler operations dashboard

## Design brief

The dashboard is an operator-facing control plane for bounded business crawl workloads. It must make job state, progress, evidence confidence, runtime health, and integration capability understandable without suggesting that unverified or disabled systems are live.

## Visual direction

- Codestra black and gold identity with restrained status colors.
- Large, calm typography and spacious panel composition inspired by high-end enterprise hardware and infrastructure interfaces.
- Fixed desktop navigation, compact sticky top bar, and a responsive mobile drawer.
- No external fonts, images, scripts, or analytics.
- System fonts, semantic HTML, visible keyboard focus, and reduced-motion support.

## Information architecture

1. **Overview** — KPIs, workload distribution, recent jobs, dependency health, and capability truth.
2. **Jobs** — tenant-scoped list, status/search filters, progress, details, cancellation, and retry.
3. **New crawl** — URL list, extraction profile, browser strategy, geography, and explicit safety limits.
4. **Results** — normalized businesses, confidence, primary contact, and browser-side JSON export.
5. **Reviews** — disabled interaction preview until the stable review API is available.
6. **Deliveries** — pending/dead-letter visibility without implying middleware, n8n, or Odoo writes are active.
7. **Integrations** — capability and runtime evidence, including unavailable states.
8. **Session audit** — browser-tab interaction history, clearly separated from the server audit ledger.

## Security boundary

The checked-in configuration is deliberately safe:

```text
DEMO_MODE=true
WRITE_CONTROLS=false
DEVELOPMENT_TOKEN_FIELD=false
LIVE_SERVER_CHANGED=NO
```

The browser cannot turn write controls on. A production deployment must inject that policy through deployment-managed static configuration and should use a same-origin authenticated session or a PKCE/BFF boundary. Service-principal secrets are never embedded in the dashboard.

## Stable API usage

The implementation only treats the release branch's documented job, results, stats, health, readiness, and capabilities endpoints as real. Reviews, direct Odoo projection, n8n reverse commands, authoritative EIN verification, runtime-path verification, and production deployment remain unavailable until affirmative capability evidence exists.

## Performance budget

- No runtime or development npm dependencies.
- No external assets.
- CSS under 100 KB.
- Main application module under 70 KB.
- Every route renders without an API connection in safe preview mode.
- Dashboard-specific CI validates syntax, contracts, tests, budgets, and an HTTP smoke test.
