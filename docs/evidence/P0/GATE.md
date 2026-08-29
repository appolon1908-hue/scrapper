# Gate 0 — Trunk reconciliation

```text
PHASE: P0 Reconciliation: collapse 22 branches into one trunk
COMMIT: 0fe6255ed528308505297d5b7f591d38d6e15b9d
CHECK_GREEN: YES
INTEGRATION_GREEN: YES
COVERAGE_DELTA: N/A -> N/A (coverage tooling and the coverage ratchet begin in P1)
NEW_FLAGS: none
LIVE_SERVER_CHANGED: NO
STAGING_DEPLOYED: NO
PRODUCTION_DEPLOYED: NO
EXTERNAL_DELIVERY_ENABLED: NO
GO_LIVE: NO_GO
ROLLBACK_REHEARSED: YES
BLOCKERS: P0-T5 squash merge is incompatible with ancestry-gated legacy branch deletion; see docs/BLOCKERS.md
```

## Measured evidence

- Baseline: `75fc233`, the tip of `feature/turnkey-control-plane-dashboard-v1` at reconciliation start.
- Tracked files: 158; TypeScript source files under `src/`: 42.
- `npm run check`: PASS — lint, typecheck, 28 unit tests, and format check passed.
- `npm run test:integration`: PASS — 8 tests passed against disposable PostgreSQL 17.11 and a Redis 7-compatible Memurai 4.1.7 runtime.
- Migration inventory: 6 numbered up migrations and 6 matching down migrations; no duplicate numbers.
- Migration rollback: `006` through `001` rolled back in reverse order, the absence of `crawl_jobs` was verified, and all six migrations reapplied successfully.
- Discovery lineage: legacy `enterprise/*.mjs` files were not merged. Seed import and discovery-result normalization were ported to typed, Zod-validated TypeScript with happy-path and failure-mode tests.
- Identity lineage: the Keycloak realm/client target was recovered into `docs/architecture/IDENTITY.md` without enabling authentication.
- Authorization controls: every source receives one of the four allowed authorization bases; blocked and ToS-prohibited domain policies are enforced before crawl navigation.
- Gateway parity: Kong exposes `/platform/v2` through a dedicated route, exposes only `GET /` through an exact regex route, and no longer declares the unimplemented `/api/v2/webhooks` integration path.
- Gateway validation: CI parses both the validation fixture and production Kong configuration, then exercises the service-info and platform-admin routes through Caddy and Kong.
- External-effect state: all existing external-effect capabilities remain disabled by default.

No staging or production deployment is claimed by this gate. Gate 0 remains blocked until the Git-history policy conflict in `docs/BLOCKERS.md` is resolved.
