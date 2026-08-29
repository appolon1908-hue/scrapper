# Blockers

## P0-T5 — Squash merge cannot satisfy ancestry-gated branch deletion

**Status:** resolved by mission-owner decision
**Recorded:** 2026-08-29  
**Resolved:** 2026-08-29
**PR:** [#20](https://github.com/appolon1908-hue/scrapper/pull/20)

The Phase 0 instructions require both of the following:

1. squash-merge the phase branch into `main`; and
2. delete each legacy branch only after `git merge-base --is-ancestor origin/<branch> origin/main` succeeds.

These requirements cannot both be true. A squash merge creates a new single-parent commit on `main` and does not retain the phase commits, cherry-picked source commits, or legacy branch tips as ancestors. The required ancestry command will therefore fail even when the resulting tree contains the intended content.

The pre-merge audit also found 11 legacy branch tips that are not ancestors of the Phase 0 branch. This is expected for the three doc-only lineages and the intentionally ported-but-not-merged enterprise lineage, but it means a normal phase merge alone would not make every deletion predicate pass.

No legacy branch has been deleted. PR #20 is mergeable and all four GitHub checks pass, but it remains unmerged until the history policy is made internally consistent.

### Safe resolution options

- **Preserve ancestry:** record the reviewed legacy tips as ancestry-only parents without importing their trees, then use a regular merge for PR #20. This keeps one PR and makes the prescribed `merge-base --is-ancestor` deletion proof possible, but requires changing `--squash` to `--merge`.
- **Preserve squash:** keep the squash merge and replace ancestry proof with a committed content/patch reconciliation manifest. This retains the requested squash history, but requires changing the deletion predicate.
- **Retain legacy branches:** squash-merge and do not delete any branch whose ancestry check fails. This follows the deletion safety rule but leaves Gate 0 red because `main` would not be the only branch.

### Resolution

The mission owner selected **Preserve squash**. Prime Directive 5 is amended in `MISSION.md` to
require a committed content-reconciliation predicate instead of Git ancestry. The file-level
proof is `docs/evidence/P0/RECONCILIATION_MANIFEST.md`; its verifier requires every current
legacy branch tip and every tracked file to have one valid disposition before deletion.

No branch may be deleted if its remote tip changes or the manifest verifier reports a missing or
invalid disposition.
