# Operations dashboard interaction audit

This matrix records dashboard behavior preserved on `main` after Gate 0 reconciliation. It is source validation, not live-host or production evidence.

| Area           | Interaction                                 | API or boundary                              | Implemented state evidence                                       |
| -------------- | ------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Navigation     | Open every dashboard route                  | Browser hash router                          | Active navigation, keyboard focus, responsive menu               |
| Overview       | Refresh and change throughput range         | GET health/readiness/capabilities/stats/jobs | Loading, partial-error, ready, and preview states                |
| Jobs           | Search by URL, job ID, or correlation ID    | Loaded tenant job page                       | Matching count and no-match empty state                          |
| Jobs           | Status filter, sort, clear, load more       | GET `/api/v2/jobs`                           | Filtered rows, pagination cursor, API error banner               |
| Jobs           | Open details drawer                         | GET `/api/v2/jobs/{id}`                      | Focus containment, safe payload summary, copy actions            |
| Jobs           | Cancel or retry                             | Canonical POST endpoints                     | Confirmation, pending state, correlation ID, success/error audit |
| New crawl      | Import CSV/JSON                             | Browser-local parser                         | File limit, quoted CSV, duplicate/invalid row summary            |
| New crawl      | Apply import and type manual URLs           | Browser form state                           | Deduplicated target list without resetting other fields          |
| New crawl      | Submit crawl                                | POST `/api/v2/jobs`                          | Validation, capability gates, idempotency/correlation headers    |
| Results        | Select job, refresh, paginate               | GET `/api/v2/jobs/{id}/results`              | Loading, error, empty, and loaded states                         |
| Results        | Search, confidence, and contact filters     | Loaded result page                           | Visible count and no-match empty state                           |
| Results        | Open evidence drawer                        | Loaded result record                         | Contact copy actions and evidence/provenance display             |
| Results        | Export visible CSV/JSON                     | Browser-generated file                       | Current filtered view only; CSV escaping validated               |
| Integrations   | Run diagnostics                             | Ten documented GET endpoints                 | Pass/fail/skipped cards with duration and non-mutating notice    |
| Settings       | Open, validate, and save session connection | Session storage only                         | HTTPS enforcement and immutable write-control notice             |
| Disabled areas | Reviews, direct Odoo, n8n, EIN, deployment  | Capability response                          | Unavailable/disabled labels; no fake success behavior            |

## Documented read-only diagnostic surface

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

## Mutation safety

The client supports the canonical and command-alias create/cancel/retry paths. Diagnostics do not call them. Every mutation requires an explicit operator gesture; cancellation and retry require confirmation; crawl creation includes idempotency and correlation identifiers.

## Evidence limits

The browser smoke test runs in safe demo mode. Repository CI separately validates the backend unit contracts, PostgreSQL/Redis integration suite, migrations, replay protections, production container build, Compose model, and gateway policy. Neither test class proves that a live server, Keycloak realm, Kong/Caddy route, n8n workflow, Odoo instance, or external provider is configured.
