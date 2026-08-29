# Mission governance

This repository-tracked file records the mission amendment authorized on 2026-08-29. All
sections of `CODEX_MISSION_PLAN.md` not changed here remain in force.

## 0.1 The Prime Directives

1. **One trunk.** `main` is the only long-lived branch. Every phase gets exactly one branch,
   one PR, one merge, and one deletion pass.
2. **No phase starts until the previous phase's gate is green on `main`.** Phases do not run in
   parallel.
3. **Never claim deployment without evidence.** A deployment claim requires an immutable image
   digest, runtime inventory, canary read-back log, and rehearsed deployment rollback.
4. **Fail closed.** Every new external-effect capability ships behind a flag that defaults to
   `false`; flags flip only at Phase 9.
5. **Never delete a branch until content reconciliation succeeds.** The branch tip and every
   path returned by `git ls-tree -r --name-only <tip>` must appear in
   `docs/evidence/P0/RECONCILIATION_MANIFEST.md` with exactly one disposition:
   `ported-identical`, including a matching source/target SHA-256; `ported-rewritten`, including
   an existing target path under `src/`; or `intentionally-dropped`, including a concrete reason.
   The recorded tip must still match the remote branch at deletion time, and the manifest
   verifier must report zero missing or invalid dispositions. A mismatch stops cleanup.
6. **If a task cannot be completed as specified, stop and record the blocker.** Do not silently
   substitute a weaker implementation or stub.
7. **No new dependency** without adding it to `docs/architecture/DEPENDENCY_LEDGER.md` with a
   justification.

## P0-T6 — Squash merge and reconciled cleanup

P0-T6 is authorized only after all of the following are true:

1. The 21 legacy remote branches and their reviewed tip SHAs are recorded in the reconciliation
   manifest.
2. Every file in every recorded branch has one valid disposition and automated verification
   reports zero gaps.
3. `docs/evidence/P0/GATE.md` distinguishes migration rollback verification from deployment
   rollback rehearsal.
4. `npm run check`, `npm run test:integration`, and all required PR checks are green on the final
   Phase 0 head.
5. PR #20 is squash-merged into `main`.
6. Each legacy branch tip is rechecked against the committed manifest immediately before that
   branch is deleted. Any changed or undispositioned branch is retained and reported.
7. The stale Phase 0 PRs are closed with a pointer to the squash merge, the `p0-complete` tag is
   pushed, Gate 0 is reported, and work stops before Phase 1.

This amendment replaces the former ancestry predicate only. It does not weaken the deployment,
testing, legal-authorization, or fail-closed requirements.

## H0 — Canonical repository resolution

The repository-identity decision is **legacy Kyqra lineage**. The authoritative decision is
recorded in `docs/architecture/CANONICAL_REPOSITORY.md`:

- `appolon1908-hue/kyqra-crawler` is the canonical crawler source and future runtime authority;
- `appolon1908-hue/scrapper` is preserved migration evidence, not a separate production system;
- the original Scrapper mission's feature and deployment phases after Gate 0 are superseded for
  this repository and **must not run here**; and
- a replacement mission may run in `kyqra-crawler` only after source-and-contract parity review.

This repository is limited to the H0/H1/H2/H3 identity, trunk, lineage, and documentation
cleanup authorized by the hardening companion. No credential, frontier, provider, staging, or
production capability may be added or activated here.
