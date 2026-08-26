# CI and deployment scaffolding security review

Date: 2026-08-26  
Review branch: `hardening/runtime-path-deployment-gates`  
Base: `release/production-readiness-20260826`

## Decision

`LIVE_SERVER_CHANGED=NO`

`REMOTE_DEPLOYMENT_AUTHORIZED=NO`

`RUNTIME_PATHS_VERIFIED=NO`

The repository changes prepare gated workflows only. No runtime inventory or
deployment workflow was dispatched during this review.

## Findings resolved by this branch

### Critical: release push could mutate a configured staging host

The release workflow previously contained an automatic `remote-staging` job.
A push to `release/**` could upload files, create a default path, authenticate
to GHCR, run migrations and restart containers whenever secrets were present.

Resolution: release readiness now stops at source verification, gateway
validation, immutable publication and an ephemeral local staging/rollback
exercise. All remote deployment is manual and environment-gated.

### High: SSH host trust was created at deployment time

The production and automatic staging paths used `ssh-keyscan`, which trusts the
key observed on the deployment network.

Resolution: every audit/deploy workflow requires pinned `known_hosts` data
supplied through a protected GitHub environment and enables strict host-key
checking.

### High: server writes occurred before runtime layout verification

The previous staging workflow created directories, uploaded archives and wrote
environment/canary files before proving the real runtime layout.

Resolution: a read-only inventory produces a host-and-path fingerprint.
Deployment requires that reviewed fingerprint and recomputes it immediately
before the first write.

### High: implicit and inconsistent runtime paths

Staging and production used different default `/opt` paths. A missing secret
could silently select an unreviewed location.

Resolution: there are no runtime path defaults in deploy workflows. Runtime
root, environment file and secrets root are explicit, validated inputs.

### High: duplicate deploy and publish workflows

Two staging deploy workflows and two image publication paths created ambiguity
about the authoritative release mechanism.

Resolution: this branch keeps one staging workflow and one signed/attested
publisher inside release readiness. The duplicate staging workflow is deleted;
legacy publication entrypoints are manual, read-only and intentionally inert.

### Medium: canary and environment material persisted on the host

The old staging workflow uploaded full environment content and a `.canary.env`
file.

Resolution: environment/secrets are externally managed. Canary credentials are
used only by the isolated GitHub runner and are not written to the server.

### Medium: broad workflow permissions

Release readiness granted write/OIDC permissions to all jobs.

Resolution: the workflow default is read-only; package, attestation and OIDC
permissions exist only on the publication job.

### Medium: mutable GitHub Action references

Critical workflows used version tags.

Resolution: all third-party actions in active workflows are pinned to complete
commit SHAs. Dependabot is configured to propose reviewed updates.

## Required checks

Release branch protection is scaffolded to require:

- `validate`
- `deployment-policy`
- `gateway`

It also requires one approval, last-push approval, stale-review dismissal,
conversation resolution, linear history, admin enforcement,
and disables force-pushes and deletion.

The release branch was reported as unprotected when this review began. The
`Configure release branch protection` workflow must be run by an authorized
administrator and its result independently verified before merge.

## Residual risks and follow-up evidence

1. No actual runtime path contract has been collected yet.
2. Audit and deployment GitHub environments, approvals and credentials have
   not been verified.
3. The gateway test fixture still uses mutable test-only container tags. The
   production/staging configurations continue to require immutable digests;
   pin the test fixtures in a separate supply-chain update.
4. A real staging deployment, no-write canary and rollback have not been run by
   this branch.
5. Production remains blocked until staging evidence, rollback evidence and
   explicit release approval exist.
6. Runtime Docker access should not be granted to the read-only audit account;
   membership in the Docker group is effectively root-equivalent.
7. GitHub requires manually dispatched workflows to exist on the repository's
   default branch. The default branch is `main`, while this review targets the
   release branch. The reviewed workflow and script must enter the approved
   default control-plane lineage before inventory can be dispatched; this PR
   does not change the default branch or copy files to `main`.

## Review checklist before any remote workflow is dispatched

- [ ] Review and merge this scaffolding through a protected release branch.
- [ ] Make the reviewed manual workflow available through the approved default
      control-plane lineage.
- [ ] Apply and verify release branch protection.
- [ ] Configure audit environments with non-root, least-privilege SSH identities.
- [ ] Verify host keys out of band and store pinned `known_hosts`.
- [ ] Run the read-only inventory workflow.
- [ ] Review the artifact and record its exact fingerprint.
- [ ] Confirm all external-delivery and registry flags are false.
- [ ] Approve a manual staging deployment using the exact fingerprint.
- [ ] Review staging canary and rollback evidence.
- [ ] Obtain independent production approval tied to source SHA, image digest
      and runtime fingerprint.
