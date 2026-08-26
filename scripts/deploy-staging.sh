#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-deploy/staging.env}"
EVIDENCE_DIR="${EVIDENCE_DIR:-release-evidence/staging}"

if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
  echo "ERROR=STAGING_ENV_FILE_NOT_FOUND:$DEPLOY_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"
set +a

for reference in SCRAPPER_IMAGE KONG_IMAGE CADDY_IMAGE; do
  value="${!reference:-}"
  if [[ ! "$value" =~ @sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR=${reference}_MUST_BE_IMMUTABLE_DIGEST" >&2
    exit 1
  fi
done

export ENABLE_EXTERNAL_DELIVERY=false
export ENABLE_REGISTRY_ENRICHMENT=false

compose=(
  docker compose
  --env-file "$DEPLOY_ENV_FILE"
  -f docker-compose.yml
  -f deploy/docker-compose.staging.yml
)

mkdir -p "$EVIDENCE_DIR"
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --remove-orphans postgres redis api crawl-worker delivery-worker kong caddy

ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 5 \
    "${CANARY_API_BASE:?set CANARY_API_BASE}/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  "${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps-failed.txt"
  "${compose[@]}" logs --no-color --tail=300 > "$EVIDENCE_DIR/compose-logs-failed.txt"
  echo "ERROR=STAGING_READINESS_TIMEOUT" >&2
  exit 1
fi

RELEASE_SHA="${RELEASE_SHA:-unknown}" node scripts/no-write-canary.mjs \
  | tee "$EVIDENCE_DIR/no-write-canary.json"
"${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps.txt"
printf '%s\n' "$SCRAPPER_IMAGE" > "$EVIDENCE_DIR/scrapper-image-ref.txt"
printf '%s\n' "$KONG_IMAGE" > "$EVIDENCE_DIR/kong-image-ref.txt"
printf '%s\n' "$CADDY_IMAGE" > "$EVIDENCE_DIR/caddy-image-ref.txt"
date --utc +'%Y-%m-%dT%H:%M:%SZ' > "$EVIDENCE_DIR/deployed-at.txt"

echo "STAGING_DEPLOYMENT=PASS"
echo "EXTERNAL_DELIVERY=false"
echo "REGISTRY_ENRICHMENT=false"
