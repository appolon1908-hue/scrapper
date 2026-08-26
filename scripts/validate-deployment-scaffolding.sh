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

for file in "${active_workflows[@]}"; do
  require_file "$file"
done

require_file scripts/runtime-path-inventory.sh
require_file scripts/deploy-staging.sh
require_file scripts/rollback-staging.sh
require_file docs/release/RUNTIME_PATH_VERIFICATION.md

for obsolete in \
  .github/workflows/deploy-staging-v2.yml; do
  [[ ! -e "$obsolete" ]] || fail "OBSOLETE_WORKFLOW_PRESENT:$obsolete"
done

for file in .github/workflows/*.yml .github/workflows/*.yaml; do
  [[ -e "$file" ]] || continue
  forbid_text "$file" "ssh-keyscan"
  while IFS= read -r use_line; do
    ref="${use_line#*@}"
    ref="${ref%%[[:space:]#]*}"
    if [[ ! "$ref" =~ ^[a-f0-9]{40}$ ]]; then
      fail "UNPINNED_ACTION:$file:$use_line"
    fi
  done < <(grep -E '^[[:space:]]*-[[:space:]]+uses:[[:space:]]+[^.][^[:space:]]+@' "$file" || true)
done

require_text .github/workflows/runtime-path-inventory.yml "workflow_dispatch:"
forbid_text .github/workflows/runtime-path-inventory.yml "  push:"
forbid_text .github/workflows/runtime-path-inventory.yml "  schedule:"
require_text .github/workflows/runtime-path-inventory.yml "Runtime path inventory (read only)"
require_text .github/workflows/runtime-path-inventory.yml "scripts/runtime-path-inventory.sh"

require_text .github/workflows/publish-image.yml "intentionally inert"
require_text .github/workflows/cancel-stale-publish-runs.yml "intentionally inert"
forbid_text .github/workflows/publish-image.yml "packages: write"
forbid_text .github/workflows/publish-image.yml "  push:"
forbid_text .github/workflows/cancel-stale-publish-runs.yml "actions: write"
forbid_text .github/workflows/cancel-stale-publish-runs.yml "  schedule:"

for deploy_file in .github/workflows/deploy-staging.yml .github/workflows/production-deploy.yml; do
  require_text "$deploy_file" "workflow_dispatch:"
  forbid_text "$deploy_file" "  push:"
  forbid_text "$deploy_file" "  schedule:"
  require_text "$deploy_file" "runtime_fingerprint:"
  require_text "$deploy_file" "runtime_root:"
  require_text "$deploy_file" "runtime_env_file:"
  require_text "$deploy_file" "runtime_secrets_root:"
  require_text "$deploy_file" "ready_for_write_disabled_deploy=true"
  require_text "$deploy_file" "StrictHostKeyChecking=yes"
  require_text "$deploy_file" "UserKnownHostsFile="
  forbid_text "$deploy_file" "mkdir -p '\$STAGING_ROOT'"
  forbid_text "$deploy_file" "STAGING_ENV_CONTENT"
  forbid_text "$deploy_file" ".canary.env"
  forbid_text "$deploy_file" "SCRAPPER_PRODUCTION_PATH"
  forbid_text "$deploy_file" "/opt/codestra/scrapper-production"
done

forbid_text .github/workflows/release-readiness.yml "remote-staging:"
forbid_text .github/workflows/release-readiness.yml "SCRAPPER_STAGING_HOST"
forbid_text .github/workflows/release-readiness.yml "scp "
forbid_text .github/workflows/release-readiness.yml "ssh "

require_text .github/workflows/ci.yml "deployment-policy:"
require_text .github/workflows/ci.yml "scripts/validate-deployment-scaffolding.sh"
require_text .github/workflows/configure-release-protection.yml "\"deployment-policy\""

forbid_text scripts/runtime-path-inventory.sh "docker compose up"
forbid_text scripts/runtime-path-inventory.sh "docker compose pull"
forbid_text scripts/runtime-path-inventory.sh "systemctl start"
forbid_text scripts/runtime-path-inventory.sh "systemctl restart"
forbid_text scripts/runtime-path-inventory.sh "mkdir "
forbid_text scripts/runtime-path-inventory.sh "rm "
forbid_text scripts/runtime-path-inventory.sh "mv "
forbid_text scripts/runtime-path-inventory.sh "cp "

if (( failures > 0 )); then
  echo "DEPLOYMENT_SCAFFOLDING=FAIL"
  exit 1
fi

echo "DEPLOYMENT_SCAFFOLDING=PASS"
echo "REMOTE_AUTOMATIC_DEPLOYMENT=ABSENT"
echo "RUNTIME_PATH_FINGERPRINT_GATE=PRESENT"
