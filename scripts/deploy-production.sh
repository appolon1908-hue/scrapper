#!/usr/bin/env bash
set -euo pipefail

: "${RUNTIME_ROOT:?RUNTIME_ROOT is required}"
: "${DEPLOY_ENV_FILE:?DEPLOY_ENV_FILE is required}"
: "${RUNTIME_SECRETS_ROOT:?RUNTIME_SECRETS_ROOT is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${CANDIDATE_SCRAPPER_IMAGE:?CANDIDATE_SCRAPPER_IMAGE is required}"
: "${PREVIOUS_SCRAPPER_IMAGE:?PREVIOUS_SCRAPPER_IMAGE is required}"
: "${PACKAGE_ARCHIVE:?PACKAGE_ARCHIVE is required}"

EXPECTED_API_PORT="${EXPECTED_API_PORT:-3200}"

safe_path() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
     [[ "$value" == "/" || "$value" == *"//"* || "$value" == *"/../"* ||
        "$value" == *"/./"* || "$value" == */.. || "$value" == */. ]]; then
    echo "ERROR=${label}_IS_UNSAFE" >&2
    exit 1
  fi
}

safe_path RUNTIME_ROOT "$RUNTIME_ROOT"
safe_path DEPLOY_ENV_FILE "$DEPLOY_ENV_FILE"
safe_path RUNTIME_SECRETS_ROOT "$RUNTIME_SECRETS_ROOT"
safe_path PACKAGE_ARCHIVE "$PACKAGE_ARCHIVE"

if [[ ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR=RELEASE_SHA_IS_INVALID" >&2
  exit 1
fi
if [[ ! "$EXPECTED_API_PORT" =~ ^[0-9]{1,5}$ ]] ||
   (( EXPECTED_API_PORT < 1 || EXPECTED_API_PORT > 65535 )); then
  echo "ERROR=EXPECTED_API_PORT_IS_INVALID" >&2
  exit 1
fi
for image_var in CANDIDATE_SCRAPPER_IMAGE PREVIOUS_SCRAPPER_IMAGE; do
  value="${!image_var}"
  if [[ ! "$value" =~ ^ghcr\.io/appolon1908-hue/scrapper@sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR=${image_var}_MUST_BE_IMMUTABLE" >&2
    exit 1
  fi
done
if [[ "$CANDIDATE_SCRAPPER_IMAGE" == "$PREVIOUS_SCRAPPER_IMAGE" ]]; then
  echo "ERROR=CANDIDATE_AND_PREVIOUS_IMAGES_MUST_DIFFER" >&2
  exit 1
fi

if [[ ! -d "$RUNTIME_ROOT" || -L "$RUNTIME_ROOT" ]]; then
  echo "ERROR=RUNTIME_ROOT_MUST_EXIST_AND_NOT_BE_A_SYMLINK" >&2
  exit 1
fi
if [[ ! -f "$DEPLOY_ENV_FILE" || -L "$DEPLOY_ENV_FILE" ]]; then
  echo "ERROR=DEPLOY_ENV_FILE_MUST_BE_REGULAR" >&2
  exit 1
fi
if [[ ! -d "$RUNTIME_SECRETS_ROOT" || -L "$RUNTIME_SECRETS_ROOT" ]]; then
  echo "ERROR=RUNTIME_SECRETS_ROOT_MUST_EXIST_AND_NOT_BE_A_SYMLINK" >&2
  exit 1
fi
for flag in ENABLE_EXTERNAL_DELIVERY ENABLE_REGISTRY_ENRICHMENT; do
  if ! grep -Eq "^[[:space:]]*${flag}[[:space:]]*=[[:space:]]*false[[:space:]]*$" "$DEPLOY_ENV_FILE"; then
    echo "ERROR=${flag}_MUST_BE_FALSE" >&2
    exit 1
  fi
done

if [[ ! -f "$RUNTIME_ROOT/.current_image" || -L "$RUNTIME_ROOT/.current_image" ]]; then
  echo "ERROR=CURRENT_IMAGE_RECORD_IS_REQUIRED_FOR_PRODUCTION_ROLLBACK" >&2
  exit 1
fi
current_image="$(tr -d '\r\n' < "$RUNTIME_ROOT/.current_image")"
if [[ "$current_image" != "$PREVIOUS_SCRAPPER_IMAGE" ]]; then
  echo "ERROR=APPROVED_PREVIOUS_IMAGE_DOES_NOT_MATCH_CURRENT_RUNTIME" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_ARCHIVE" || ! -f "$PACKAGE_ARCHIVE.sha256" ]]; then
  echo "ERROR=DEPLOYMENT_PACKAGE_OR_CHECKSUM_MISSING" >&2
  exit 1
fi
(cd "$(dirname "$PACKAGE_ARCHIVE")" && sha256sum -c "$(basename "$PACKAGE_ARCHIVE").sha256")
if tar -tzf "$PACKAGE_ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "ERROR=UNSAFE_ARCHIVE_PATH" >&2
  exit 1
fi

release_dir="$RUNTIME_ROOT/releases/$RELEASE_SHA"
backup_dir="$RUNTIME_ROOT/backups"
install -d -m 0750 "$RUNTIME_ROOT/releases" "$backup_dir" "$release_dir"
tar -xzf "$PACKAGE_ARCHIVE" --no-same-owner --no-same-permissions -C "$release_dir"
cd "$release_dir"
printf '%s\n' "$RELEASE_SHA" > .source_sha
sha256sum "$PACKAGE_ARCHIVE" | awk '{print $1}' > .package_sha256

export SCRAPPER_IMAGE="$CANDIDATE_SCRAPPER_IMAGE"
export ENABLE_EXTERNAL_DELIVERY=false
export ENABLE_REGISTRY_ENRICHMENT=false
compose=(docker compose --env-file "$DEPLOY_ENV_FILE" -f docker-compose.yml)

install -d -m 0750 release-evidence/production
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d postgres redis

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_dir/predeploy-$timestamp.dump"
"${compose[@]}" exec -T postgres pg_dump -U scrapper -d scrapper -Fc > "$backup_path"
printf '%s\n' "$backup_path" > release-evidence/production/database-backup-path.txt

"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-deps api crawl-worker delivery-worker

ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 5 \
    "http://127.0.0.1:${EXPECTED_API_PORT}/readyz" >/dev/null; then
    ready=true
    break
  fi
  sleep 2
done

if [[ "$ready" != "true" ]]; then
  "${compose[@]}" ps > release-evidence/production/compose-ps-failed.txt || true
  "${compose[@]}" logs --no-color --tail=300 api crawl-worker delivery-worker \
    > release-evidence/production/compose-logs-failed.txt || true
  RUNTIME_ROOT="$RUNTIME_ROOT" \
  DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" \
  RELEASE_SHA="$RELEASE_SHA" \
  PREVIOUS_SCRAPPER_IMAGE="$PREVIOUS_SCRAPPER_IMAGE" \
  EXPECTED_API_PORT="$EXPECTED_API_PORT" \
  EVIDENCE_DIR="$release_dir/release-evidence/production-readiness-rollback" \
    bash scripts/rollback-production.sh || true
  echo "ERROR=PRODUCTION_CANDIDATE_READINESS_TIMEOUT" >&2
  exit 1
fi

"${compose[@]}" ps > release-evidence/production/compose-ps.txt
printf '%s\n' "$CANDIDATE_SCRAPPER_IMAGE" > release-evidence/production/candidate-image-ref.txt
printf '%s\n' "$PREVIOUS_SCRAPPER_IMAGE" > release-evidence/production/approved-rollback-image-ref.txt
printf '%s\n' "$RELEASE_SHA" > release-evidence/production/release-sha.txt
printf '%s\n' "$timestamp" > release-evidence/production/deployed-at.txt
printf '%s\n' 'external_delivery=false' > release-evidence/production/write-state.txt
printf '%s\n' 'registry_enrichment=false' >> release-evidence/production/write-state.txt
printf '%s\n' 'candidate_identity_recorded=false' > release-evidence/production/identity-state.txt

rm -f "$PACKAGE_ARCHIVE" "$PACKAGE_ARCHIVE.sha256"

echo "PRODUCTION_CANDIDATE_DEPLOYMENT=PASS"
echo "CANDIDATE_IDENTITY_RECORDED=false"
echo "CANARY_REQUIRED=true"
echo "EXTERNAL_DELIVERY=false"
echo "REGISTRY_ENRICHMENT=false"
