#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:?set the externally managed deployment environment file}"
EVIDENCE_DIR="${EVIDENCE_DIR:-release-evidence/staging}"
READINESS_URL="${READINESS_URL:-http://127.0.0.1:3200/readyz}"
RELEASE_SHA="${RELEASE_SHA:-unknown}"

if [[ ! -f "$DEPLOY_ENV_FILE" || -L "$DEPLOY_ENV_FILE" ]]; then
  echo "ERROR=DEPLOY_ENV_FILE_MUST_BE_A_REGULAR_FILE:$DEPLOY_ENV_FILE" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*ENABLE_EXTERNAL_DELIVERY[[:space:]]*=[[:space:]]*false[[:space:]]*$' "$DEPLOY_ENV_FILE"; then
  echo "ERROR=EXTERNAL_DELIVERY_MUST_BE_EXPLICITLY_DISABLED" >&2
  exit 1
fi
if ! grep -Eq '^[[:space:]]*ENABLE_REGISTRY_ENRICHMENT[[:space:]]*=[[:space:]]*false[[:space:]]*$' "$DEPLOY_ENV_FILE"; then
  echo "ERROR=REGISTRY_ENRICHMENT_MUST_BE_EXPLICITLY_DISABLED" >&2
  exit 1
fi

read_env_value() {
  local file="$1"
  local key="$2"
  local count value

  count="$(
    awk -F= -v key="$key" '
      /^[[:space:]]*#/ { next }
      {
        lhs=$1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", lhs)
        if (lhs == key) count++
      }
      END { print count+0 }
    ' "$file"
  )"
  if [[ "$count" != "1" ]]; then
    echo "ERROR=ENV_KEY_MUST_APPEAR_ONCE:$key" >&2
    exit 1
  fi
  value="$(
    awk -F= -v key="$key" '
      /^[[:space:]]*#/ { next }
      {
        lhs=$1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", lhs)
        if (lhs == key) {
          sub(/^[^=]*=/, "")
          gsub(/^[[:space:]]+|[[:space:]]+$/, "")
          print
        }
      }
    ' "$file"
  )"
  printf '%s' "$value"
}

SCRAPPER_IMAGE="${CANDIDATE_SCRAPPER_IMAGE:-$(read_env_value "$DEPLOY_ENV_FILE" SCRAPPER_IMAGE)}"
KONG_IMAGE="$(read_env_value "$DEPLOY_ENV_FILE" KONG_IMAGE)"
CADDY_IMAGE="$(read_env_value "$DEPLOY_ENV_FILE" CADDY_IMAGE)"
export SCRAPPER_IMAGE KONG_IMAGE CADDY_IMAGE

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
  if curl --fail --silent --show-error --max-time 5 "$READINESS_URL" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" != "1" ]]; then
  "${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps-failed.txt" || true
  "${compose[@]}" logs --no-color --tail=300 > "$EVIDENCE_DIR/compose-logs-failed.txt" || true
  echo "ERROR=STAGING_READINESS_TIMEOUT" >&2
  exit 1
fi

"${compose[@]}" ps > "$EVIDENCE_DIR/compose-ps.txt"
printf '%s\n' "$SCRAPPER_IMAGE" > "$EVIDENCE_DIR/scrapper-image-ref.txt"
printf '%s\n' "$KONG_IMAGE" > "$EVIDENCE_DIR/kong-image-ref.txt"
printf '%s\n' "$CADDY_IMAGE" > "$EVIDENCE_DIR/caddy-image-ref.txt"
printf '%s\n' "$RELEASE_SHA" > "$EVIDENCE_DIR/release-sha.txt"
printf '%s\n' "$READINESS_URL" > "$EVIDENCE_DIR/readiness-url.txt"
date --utc +'%Y-%m-%dT%H:%M:%SZ' > "$EVIDENCE_DIR/deployed-at.txt"

echo "STAGING_DEPLOYMENT=PASS"
echo "EXTERNAL_DELIVERY=false"
echo "REGISTRY_ENRICHMENT=false"
echo "CANARY_EXECUTION=DEFERRED_TO_RUNNER"
