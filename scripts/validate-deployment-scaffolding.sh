#!/usr/bin/env bash
set -euo pipefail

failures=0

fail() {
  echo "ERROR=$1" >&2
  failures=$((failures + 1))
}

require_file() {
  [[ -f "$1" ]] || fail "MISSING_FILE:$1"
}

require_text() {
  local file="$1"
  local text="$2"
  grep -Fq -- "$text" "$file" || fail "MISSING_REQUIRED_TEXT:$file:$text"
}

forbid_text() {
  local file="$1"
  local text="$2"
  if grep -Fq -- "$text" "$file"; then
    fail "FORBIDDEN_TEXT:$file:$text"
  fi
}

active_workflows=(
  .github/workflows/ci.yml
  .github/workflows/configure-release-protection.yml
  .github/workflows/deploy-staging.yml
  .github/workflows/gateway-validation.yml
  .github/workflows/production-deploy.yml
  .github/workflows/release-readiness.yml
  .github/workflows/runtime-path-inventory.yml
  .github/workflows/publish-image.yml
  .github/workflows/cancel-stale-publish-runs.yml
)

required_scripts=(
  scripts/runtime-path-inventory.sh
  scripts/verify-release-context.sh
  scripts/verify-release-image.sh
  scripts/validate-workflow-policy.rb
  scripts/validate-deployment-scaffolding.sh
  scripts/deploy-staging.sh
  scripts/rollback-staging.sh
  scripts/deploy-production.sh
  scripts/rollback-production.sh
)

for file in "${active_workflows[@]}" "${required_scripts[@]}"; do
  require_file "$file"
done
require_file docs/release/RUNTIME_PATH_VERIFICATION.md

[[ ! -e .github/workflows/deploy-staging-v2.yml ]] || fail 'OBSOLETE_WORKFLOW_PRESENT:deploy-staging-v2.yml'

if command -v ruby >/dev/null 2>&1; then
  ruby scripts/validate-workflow-policy.rb || fail 'PARSED_WORKFLOW_POLICY_FAILED'
else
  fail 'RUBY_REQUIRED_FOR_WORKFLOW_POLICY'
fi

for file in .github/workflows/*.yml .github/workflows/*.yaml; do
  [[ -e "$file" ]] || continue
  forbid_text "$file" 'ssh-keyscan'
done

require_text .github/workflows/runtime-path-inventory.yml 'workflow_dispatch:'
forbid_text .github/workflows/runtime-path-inventory.yml '  push:'
forbid_text .github/workflows/runtime-path-inventory.yml '  schedule:'
require_text .github/workflows/runtime-path-inventory.yml 'Runtime path inventory (read only)'
require_text .github/workflows/runtime-path-inventory.yml 'scripts/runtime-path-inventory.sh'

for legacy in .github/workflows/publish-image.yml .github/workflows/cancel-stale-publish-runs.yml; do
  require_text "$legacy" 'intentionally inert'
  forbid_text "$legacy" '  push:'
  forbid_text "$legacy" '  schedule:'
done
forbid_text .github/workflows/publish-image.yml 'packages: write'
forbid_text .github/workflows/cancel-stale-publish-runs.yml 'actions: write'

for deploy_file in .github/workflows/deploy-staging.yml .github/workflows/production-deploy.yml; do
  require_text "$deploy_file" 'workflow_dispatch:'
  forbid_text "$deploy_file" '  push:'
  forbid_text "$deploy_file" '  schedule:'
  require_text "$deploy_file" 'runtime_fingerprint:'
  require_text "$deploy_file" 'runtime_root:'
  require_text "$deploy_file" 'runtime_env_file:'
  require_text "$deploy_file" 'runtime_secrets_root:'
  require_text "$deploy_file" 'ready_for_write_disabled_deploy=true'
  require_text "$deploy_file" 'StrictHostKeyChecking=yes'
  require_text "$deploy_file" 'UserKnownHostsFile='
  require_text "$deploy_file" 'scripts/verify-release-context.sh'
  require_text "$deploy_file" 'scripts/verify-release-image.sh'
  require_text "$deploy_file" 'DOCKER_CONFIG='
  require_text "$deploy_file" 'docker_config='
  require_text "$deploy_file" 'rm -rf'
  require_text "$deploy_file" '--password-stdin'
  forbid_text "$deploy_file" 'ssh-keyscan'
  forbid_text "$deploy_file" 'STAGING_ENV_CONTENT'
  forbid_text "$deploy_file" '.canary.env'
  forbid_text "$deploy_file" '/opt/codestra/scrapper-production'
done

require_text .github/workflows/deploy-staging.yml 'PREVIOUS_IMAGE_REF'
require_text .github/workflows/deploy-staging.yml 'IMAGE_RELATIONSHIP: ancestor'
require_text .github/workflows/production-deploy.yml 'PREVIOUS_IMAGE_REF'
require_text .github/workflows/production-deploy.yml 'IMAGE_RELATIONSHIP: ancestor'
require_text .github/workflows/production-deploy.yml 'rollback-production.sh'
require_text .github/workflows/production-deploy.yml 'fail-after-rollback'
require_text .github/workflows/production-deploy.yml 'database_restore_performed=false'

forbid_text .github/workflows/release-readiness.yml 'remote-staging:'
forbid_text .github/workflows/release-readiness.yml 'SCRAPPER_STAGING_HOST'
forbid_text .github/workflows/release-readiness.yml 'scp '
forbid_text .github/workflows/release-readiness.yml 'ssh '
require_text .github/workflows/release-readiness.yml 'needs: [verify, deployment-policy, branch-governance, gateway-validation]'

require_text .github/workflows/ci.yml 'deployment-policy:'
require_text .github/workflows/ci.yml 'scripts/validate-workflow-policy.rb'
require_text .github/workflows/configure-release-protection.yml '"deployment-policy"'

forbid_text scripts/runtime-path-inventory.sh 'docker compose up'
forbid_text scripts/runtime-path-inventory.sh 'docker compose pull'
forbid_text scripts/runtime-path-inventory.sh 'systemctl start'
forbid_text scripts/runtime-path-inventory.sh 'systemctl restart'
forbid_text scripts/runtime-path-inventory.sh 'mkdir '
forbid_text scripts/runtime-path-inventory.sh 'rm '
forbid_text scripts/runtime-path-inventory.sh 'mv '
forbid_text scripts/runtime-path-inventory.sh 'cp '

if (( failures > 0 )); then
  echo 'DEPLOYMENT_SCAFFOLDING=FAIL'
  exit 1
fi

echo 'DEPLOYMENT_SCAFFOLDING=PASS'
echo 'REMOTE_AUTOMATIC_DEPLOYMENT=ABSENT'
echo 'RUNTIME_PATH_FINGERPRINT_GATE=PRESENT'
echo 'EXACT_RELEASE_HEAD_GATE=PRESENT'
echo 'ROLLBACK_IMAGE_VERIFICATION=PRESENT'
echo 'CANARY_FAILURE_APPLICATION_ROLLBACK=PRESENT'
echo 'RUN_SCOPED_REMOTE_DOCKER_AUTH=PRESENT'
