# Phase 0 remote-branch test matrix

**Executed:** 2026-08-29  
**Target repository:** `appolon1908-hue/scrapper`  
**Remote branches fetched:** 23  
**Unique branch-head commits:** 20

## Method

Each unique remote head was checked out as a detached, disposable Git worktree. Runnable
heads received a clean dependency installation followed by the branch's own `npm run check`
command. A locked branch used `npm ci`; a branch without `package-lock.json` used `npm install`
and is explicitly marked non-reproducible. Exact duplicate heads share one execution result but
remain listed separately below.

PostgreSQL 17.11 and Redis-compatible Memurai 4.1.7 were available for integration-bearing
checks. The first `feature/enterprise-control-plane-v3-20260826` execution began before
PostgreSQL was started, so it was discarded and rerun from another clean worktree. The retry
result below is the authoritative result.

The current Phase 0 head also received a separate `npm run test:integration` run after the
matrix: 8 passed, 0 failed, including the full six-migration rollback/reapply test.

No branch, PR, deployment, or production state was changed by this test pass.

## Results

| Remote branch                                              | Tip SHA                                    | Install       | Result                   | Evidence                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------ | ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `backup/enterprise-ingestion-before-sync-20260826T151534Z` | `25c17d56a19f17b24eedad4a5660c97bc2c874a3` | `npm ci`      | PASS                     | 10/10 tests; same exact head as `feature/enterprise-ingestion-discovery-v2b-20260826`                                            |
| `docs/stage0-deployment-truth-20260829`                    | `9a970784adff4697b7782d0e7f41153be16901d6` | n/a           | NOT RUNNABLE             | Documentation-only branch; no `package.json`                                                                                     |
| `feature/business-intelligence-pipeline`                   | `6f0d824cad6266f99006378f9f81f87bafba321a` | `npm install` | CHECK EXITED 0; NO TESTS | 0 tests; no lockfile; same exact head as two branches below                                                                      |
| `feature/enterprise-control-plane-v3-20260826`             | `88f2ca1232ec14ccd47331ff207b82b95b94b15a` | `npm ci`      | FAIL                     | 16/18 tests; `outbox acknowledgements are fenced to the active claimant` supplies `lock-a` to a PostgreSQL UUID column (`22P02`) |
| `feature/enterprise-ingestion-discovery-v2-20260826`       | `0708edcf14d57c6c999e53559b00d6145ebb6ae9` | `npm ci`      | PASS                     | 10/10 tests                                                                                                                      |
| `feature/enterprise-ingestion-discovery-v2b-20260826`      | `25c17d56a19f17b24eedad4a5660c97bc2c874a3` | `npm ci`      | PASS                     | 10/10 tests; exact duplicate-head execution noted above                                                                          |
| `feature/enterprise-platform-foundation-20260826`          | `549fde1b14dedf8d45c901a3847d1047eb521836` | `npm install` | CHECK EXITED 0; NO TESTS | 0 tests; no lockfile                                                                                                             |
| `feature/enterprise-platform-v2-20260826`                  | `a96b622648825dcc5585385d0a140a3291be0f1b` | `npm ci`      | PASS                     | 10/10 tests                                                                                                                      |
| `feature/operations-dashboard`                             | `d17a4c3eeef06cb49ba49e6d435762b6a96ad636` | `npm ci`      | FAIL                     | Repository format gate reports 44 files                                                                                          |
| `feature/operations-dashboard-production-v2`               | `ebb35fe01bdab04d8b81956dbdb05419b089ff28` | `npm ci`      | FAIL                     | Repository format gate reports 44 files                                                                                          |
| `feature/turnkey-control-plane-api-v1`                     | `8580361c4b8ba293b89fb1470b17c0f3a4087346` | `npm ci`      | PASS                     | 14/14 tests                                                                                                                      |
| `feature/turnkey-control-plane-dashboard-v1`               | `75fc233e113eff95b288df98a25c136efcf86c8c` | `npm ci`      | PASS                     | 14/14 tests                                                                                                                      |
| `feature/turnkey-kong-control-plane-v1`                    | `e3a769b5cbce95909c0d8c3af57b1dca68f6d0b2` | `npm ci`      | FAIL                     | Repository format gate reports 45 files                                                                                          |
| `hardening/runtime-path-deployment-gates`                  | `aec0f259b0b526b359938d42744c54f3c83561ce` | `npm ci`      | FAIL                     | Repository format gate reports 33 files                                                                                          |
| `hardening/security-observability`                         | `6f0d824cad6266f99006378f9f81f87bafba321a` | `npm install` | CHECK EXITED 0; NO TESTS | 0 tests; no lockfile; exact duplicate-head execution noted above                                                                 |
| `integration/kong-caddy-odoo-n8n`                          | `6f0d824cad6266f99006378f9f81f87bafba321a` | `npm install` | CHECK EXITED 0; NO TESTS | 0 tests; no lockfile; exact duplicate-head execution noted above                                                                 |
| `integration/n8n-crawler-automation-v2-20260827`           | `ce0454778b5822a0b2dd80890ecf86db0da03203` | `npm ci`      | FAIL                     | Repository format gate reports 34 files                                                                                          |
| `main`                                                     | `70d7648d6591af54fad500db67e54274c01f90f2` | n/a           | NOT RUNNABLE             | README-only branch; no `package.json`                                                                                            |
| `ops/codex-docker-deployment`                              | `649d41a47953db281f7fed74285b103243f6d3cc` | `npm install` | CHECK EXITED 0; NO TESTS | 0 tests; no lockfile                                                                                                             |
| `phase0/trunk-reconciliation`                              | `377e8212dd92708e0de185e26d1769d5e5ee4dbe` | `npm ci`      | PASS                     | 28/28 unit tests; separate integration run 8/8                                                                                   |
| `refactor/modular-production-core`                         | `70a99ca9ea29041fa1d5cbab965dc0e400723ba0` | `npm ci`      | PASS                     | 10/10 tests                                                                                                                      |
| `release/production-readiness-20260826`                    | `4de79fed63f30390d5d5be184fb468cce4df8a24` | `npm ci`      | FAIL                     | Repository format gate reports 34 files                                                                                          |
| `security/enterprise-keycloak-n8n-ein-v2-20260826`         | `df89f8ea09f8b166122b6afd4e4f3612bbb0fda7` | `npm ci`      | PASS                     | 10/10 tests                                                                                                                      |

## Interpretation

- The merge candidate is green from a clean install: 28/28 unit tests and 8/8 integration
  tests.
- Nine remote branches map to tested, passing heads.
- Five branches have a successful check command but no executable tests; they are not counted
  as positive test evidence.
- Seven legacy branches fail their own check. Six failures are historical format debt. The
  enterprise-control-plane-v3 failure is a real invalid-UUID integration fixture.
- Two branches are non-runnable because they do not contain an application package.

These legacy failures do not authorize silently dropping unique content. Branch deletion still
requires complete file-level disposition in `RECONCILIATION_MANIFEST.md`.
