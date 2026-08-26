#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-deploy/staging.env}"
EVIDENCE_DIR="${EVIDENCE_DIR:-release-evidence/rollback}"
PREVIOUS_SCRAPPER_IMAGE="${PREVIOUS_SCRAPPER_IMAGE:?set previous immutable scraper image reference}"

if [[ ! "$PREVIOUS_SCRAPPER_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]; then
  echo "ERROR=PREVIOUS_SCRAPPER_IMAGE_MUST_BE_IMMUTABLE_DIGEST" >&2
  exit 1
fi
if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
  echo "ERROR=STAGING_ENV_FILE_NOT_FOUND:$DEPLOY_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"
set +a

export SCRAPPER_IMAGE="$PREVIOUS_SCRAPPER_IMAGE"
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
"${compose[@]}" pull api crawl-worker delivery-worker migrate
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --no-deps api crawl-worker delivery-worker

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
  "${compose[@]}" logs --no-color --tail=300 api crawl-worker delivery-worker \
    > "$EVIDENCE_DIR/compose-logs-failed.txt"
  echo "ERROR=ROLLBACK_READINESS_TIMEOUT" >&2
  exit 1
fi

RELEASE_SHA="rollback" node scripts/no-write-canary.mjs \
  | tee "$EVIDENCE_DIR/no-write-canary.json"
"${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps.txt"
printf '%s\n' "$PREVIOUS_SCRAPPER_IMAGE" > "$EVIDENCE_DIR/restored-image-ref.txt"
date --utc +'%Y-%m-%dT%H:%M:%SZ' > "$EVIDENCE_DIR/rolled-back-at.txt"

echo "STAGING_ROLLBACK=PASS"
echo "RESTORED_IMAGE=$PREVIOUS_SCRAPPER_IMAGE"
echo "EXTERNAL_DELIVERY=false"
