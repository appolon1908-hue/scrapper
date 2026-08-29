# Gate 0 — Trunk reconciliation

```text
PHASE: P0 Reconciliation: collapse 22 branches into one trunk
COMMIT: 41899494aad03297404391b46c8955c8d819373c
CHECK_GREEN: YES
INTEGRATION_GREEN: YES
COVERAGE_DELTA: N/A -> N/A (coverage tooling and the coverage ratchet begin in P1)
NEW_FLAGS: none
LIVE_SERVER_CHANGED: NO
STAGING_DEPLOYED: NO
PRODUCTION_DEPLOYED: NO
EXTERNAL_DELIVERY_ENABLED: NO
GO_LIVE: NO_GO
ROLLBACK_REHEARSED: NO
MIGRATION_ROLLBACK_VERIFIED: YES
BLOCKERS: none
```

## Measured evidence

- Baseline: commit `75fc233` at reconciliation start. Its historical branch identity remains in the sealed branch-test matrix.
- Tracked files: 165; TypeScript source files under `src/`: 42.
- `npm run check`: PASS — lint, typecheck, 28 unit tests, and format check passed.
- `npm run test:integration`: PASS — 8 tests passed against disposable PostgreSQL 17.11 and a Redis 7-compatible Memurai 4.1.7 runtime.
- Migration inventory: 6 numbered up migrations and 6 matching down migrations; no duplicate numbers.
- Migration rollback: `006` through `001` rolled back in reverse order, the absence of `crawl_jobs` was verified, and all six migrations reapplied successfully.
- Discovery lineage: legacy `enterprise/*.mjs` files were not merged. Seed import and discovery-result normalization were ported to typed, Zod-validated TypeScript with happy-path and failure-mode tests.
- Identity lineage: the Keycloak realm/client target was recovered into `docs/architecture/IDENTITY.md` without enabling authentication.
- Authorization controls: every source receives one of the four allowed authorization bases; blocked and ToS-prohibited domain policies are enforced before crawl navigation.
- Gateway parity: Kong exposes `/platform/v2` through a dedicated route, exposes only `GET /` through an exact regex route, and no longer declares the unimplemented `/api/v2/webhooks` integration path.
- Gateway validation: CI parses both the validation fixture and production Kong configuration, then exercises the service-info and platform-admin routes through Caddy and Kong.
- Branch test pass: all 23 live remote branches were inventoried; all 20 unique heads were checked, with clean-install results recorded in `docs/evidence/P0/BRANCH_TEST_MATRIX.md`.
- Content reconciliation: all 21 legacy branches and 1,662 tracked file occurrences have a verified disposition — 883 ported-identical, 8 ported-rewritten, 771 intentionally-dropped, and 0 missing.
- External-effect state: all existing external-effect capabilities remain disabled by default.

No staging or production deployment is claimed by this gate. The Git-history policy conflict is
resolved by the content-reconciliation amendment in `MISSION.md`; Gate 0 is ready for the
authorized squash merge and P0-T6 cleanup.
