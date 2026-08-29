# CI and deployment scaffolding security review

Date: 2026-08-27  
Review branch: `hardening/runtime-path-deployment-gates`  
Base: `release/production-readiness-20260826`

## Decision

```text
LIVE_SERVER_CHANGED=NO
REMOTE_DEPLOYMENT_AUTHORIZED=NO
RUNTIME_PATHS_VERIFIED=NO
STAGING_DEPLOYED=NO
PRODUCTION_DEPLOYED=NO
GO_LIVE=NO_GO
```

This branch prepares secure CI, release, runtime-inventory, staging and production
deployment controls. It does not authorize a remote deployment and it does not
establish that any server path, environment file, secret mount, Kong route,
Caddy route, n8n workflow or Odoo instance exists at the expected location.

No runtime inventory, SSH session, branch-protection mutation, staging workflow
or production workflow was dispatched while preparing these corrections.

## Corrected review blockers

### Production canary failure restores the previous application image

Production now requires a separately supplied previous immutable image. The
candidate and previous image are both verified before any server write. If the
candidate deployment or runner-side no-write canary fails, the workflow restores
the verified previous application image and proves readiness before failing the
release operation.

The automatic response is deliberately application-only. It does not perform a
destructive database restore. The pre-deployment PostgreSQL dump is retained as
reviewed recovery evidence and database restoration remains a separately
approved operation.

### Deployment is bound to the exact protected release head

Deployment no longer accepts any ancestor of a protected branch. The requested
source SHA must equal the current head of the protected release branch.

The deployment preflight also queries GitHub for exact-SHA check runs and
requires the latest successful results for:

- `validate`
- `deployment-policy`
- `gateway`

This blocks deployment of an older release after a later security fix reaches
the release branch.

### Rollback images receive full supply-chain verification

The candidate image must carry the exact requested release revision. The
rollback image must carry a different revision that is an ancestor of the same
accepted release lineage.

Both images must pass:

- immutable GHCR digest validation;
- OCI revision-label validation;
- Cosign keyless signature verification;
- certificate identity bound to the exact release-readiness workflow and exact
  protected release branch;
- GitHub repository provenance-attestation verification.

### Remote registry credentials are run-scoped and ephemeral

Every remote image pull now uses a run-specific `DOCKER_CONFIG` directory under
`/tmp`. A shell trap logs out and removes the directory. The final cleanup step
also removes residual directories for the same workflow run and attempt.

The deployment account's default Docker configuration is not used for GHCR
credentials.

## Additional hardening completed

- Every non-pushing checkout disables persisted Git credentials.
- External Actions are pinned to complete commit SHAs.
- Workflow policy is parsed as YAML, including job-level reusable-workflow
  references and flow-style syntax; grep is no longer the authoritative parser.
- Manual audit and deployment workflows reject terminal `/.` and `/..` path
  components in addition to traversal and repeated separators.
- Image publication depends on successful source, deployment-policy, branch
  governance and gateway validation.
- Staging now restores the verified previous image if any candidate, canary,
  rollback-rehearsal or restoration gate fails.
- The candidate is recorded as current only after the candidate canary,
  rollback rehearsal, rollback canary, candidate restoration and restored
  canary all succeed.
- Deployment packages exclude runtime environment files and secrets.
- Runtime inventory and deployment use pinned `known_hosts`; `ssh-keyscan` is
  forbidden.
- All initial staging and production paths require:

```text
ENABLE_EXTERNAL_DELIVERY=false
ENABLE_REGISTRY_ENRICHMENT=false
```

## Validation performed without a live host

The corrected branch was validated locally without connecting to a remote
server:

- parsed workflow policy: pass;
- Bash syntax and ShellCheck: pass;
- deployment-scaffolding policy: pass;
- locked dependency installation: pass;
- lint and strict TypeScript: pass;
- unit and contract tests: pass;
- real disposable PostgreSQL 17 and Redis 7.4 integration tests: pass;
- migration, rollback/reapply, lease and replay tests: pass;
- production Docker image build: pass;
- Docker Compose configuration validation: pass;
- isolated Kong/Caddy TLS, mTLS, allowlist, request-size and rate-limit tests:
  pass;
- `git diff --check`: pass.

GitHub Actions on the unchanged final PR head remain the authoritative review
gates.

## Required controls before read-only runtime inventory

1. The corrected PR must have green exact-head `validate`,
   `deployment-policy` and `gateway` checks.
2. A different human reviewer must approve the unchanged final SHA.
3. Review conversations must be resolved.
4. The release branch protection policy must be applied and independently
   verified through the authorized governance path.
5. The reviewed manual inventory workflow must be available through the
   approved default control-plane lineage.
6. `staging-runtime-audit` or `production-runtime-audit` must use a non-root,
   least-privilege SSH identity without Docker-group access.
7. The host key must be verified out of band and pinned in the protected
   environment.

## Required controls before staging deployment

1. Run **Runtime path inventory (read only)**.
2. Review the complete artifact and confirm `server_modified=false`.
3. Confirm `ready_for_write_disabled_deploy=true`.
4. Record the exact runtime fingerprint in the change record.
5. Publish and verify the exact release image and the approved rollback image.
6. Approve the staging environment with the exact source SHA, candidate digest,
   previous digest and runtime fingerprint.
7. Run the write-disabled staging deployment, no-write canary, rollback
   rehearsal and candidate-restoration canary.

## Required controls before production deployment

Production remains blocked until the staging evidence and rollback evidence are
reviewed, an explicit production approval names the unchanged source SHA,
candidate digest, rollback digest and runtime fingerprint, and the production
environment approval is granted by an authorized person other than the author
where policy requires it.

The next permitted remote action is the read-only runtime inventory. A remote
deployment is not the next permitted action.
