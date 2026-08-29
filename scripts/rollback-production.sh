#!/usr/bin/env bash
set -euo pipefail

: "${RUNTIME_ROOT:?RUNTIME_ROOT is required}"
: "${DEPLOY_ENV_FILE:?DEPLOY_ENV_FILE is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${PREVIOUS_SCRAPPER_IMAGE:?PREVIOUS_SCRAPPER_IMAGE is required}"

EXPECTED_API_PORT="${EXPECTED_API_PORT:-3200}"
EVIDENCE_DIR="${EVIDENCE_DIR:-$RUNTIME_ROOT/releases/$RELEASE_SHA/release-evidence/production-rollback}"

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
safe_path EVIDENCE_DIR "$EVIDENCE_DIR"

if [[ ! "$EXPECTED_API_PORT" =~ ^[0-9]{1,5}$ ]] ||
   (( EXPECTED_API_PORT < 1 || EXPECTED_API_PORT > 65535 )); then
  echo "ERROR=EXPECTED_API_PORT_IS_INVALID" >&2
  exit 1
fi
if [[ ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR=RELEASE_SHA_IS_INVALID" >&2
  exit 1
fi
if [[ ! "$PREVIOUS_SCRAPPER_IMAGE" =~ ^ghcr\.io/appolon1908-hue/scrapper@sha256:[a-f0-9]{64}$ ]]; then
  echo "ERROR=PREVIOUS_IMAGE_MUST_BE_IMMUTABLE" >&2
  exit 1
fi
if [[ ! -f "$DEPLOY_ENV_FILE" || -L "$DEPLOY_ENV_FILE" ]]; then
  echo "ERROR=DEPLOY_ENV_FILE_MUST_BE_REGULAR" >&2
  exit 1
fi
for flag in ENABLE_EXTERNAL_DELIVERY ENABLE_REGISTRY_ENRICHMENT; do
  if ! grep -Eq "^[[:space:]]*${flag}[[:space:]]*=[[:space:]]*false[[:space:]]*$" "$DEPLOY_ENV_FILE"; then
    echo "ERROR=${flag}_MUST_BE_FALSE" >&2
    exit 1
  fi
done

release_dir="$RUNTIME_ROOT/releases/$RELEASE_SHA"
if [[ ! -d "$release_dir" || -L "$release_dir" || ! -f "$release_dir/docker-compose.yml" ]]; then
  echo "ERROR=RELEASE_DIRECTORY_IS_NOT_AVAILABLE_FOR_ROLLBACK" >&2
  exit 1
fi

export SCRAPPER_IMAGE="$PREVIOUS_SCRAPPER_IMAGE"
export ENABLE_EXTERNAL_DELIVERY=false
export ENABLE_REGISTRY_ENRICHMENT=false
compose=(docker compose --env-file "$DEPLOY_ENV_FILE" -f "$release_dir/docker-compose.yml")

install -d -m 0750 "$EVIDENCE_DIR"
"${compose[@]}" config --quiet
"${compose[@]}" pull api crawl-worker delivery-worker migrate
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
  "${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps-failed.txt" || true
  "${compose[@]}" logs --no-color --tail=300 api crawl-worker delivery-worker \
    > "$EVIDENCE_DIR/compose-logs-failed.txt" || true
  echo "ERROR=PRODUCTION_APPLICATION_ROLLBACK_READINESS_TIMEOUT" >&2
  exit 1
fi

"${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps.txt"
printf '%s\n' "$PREVIOUS_SCRAPPER_IMAGE" > "$EVIDENCE_DIR/restored-image-ref.txt"
printf '%s\n' "$RELEASE_SHA" > "$EVIDENCE_DIR/failed-candidate-release-sha.txt"
printf '%s\n' 'database_restore_performed=false' > "$EVIDENCE_DIR/database-restore-status.txt"
date --utc +'%Y-%m-%dT%H:%M:%SZ' > "$EVIDENCE_DIR/rolled-back-at.txt"
printf '%s\n' "$PREVIOUS_SCRAPPER_IMAGE" > "$RUNTIME_ROOT/.current_image"

echo "PRODUCTION_APPLICATION_ROLLBACK=PASS"
echo "RESTORED_IMAGE=$PREVIOUS_SCRAPPER_IMAGE"
echo "DATABASE_RESTORE_PERFORMED=false"
echo "EXTERNAL_DELIVERY=false"
echo "REGISTRY_ENRICHMENT=false"
