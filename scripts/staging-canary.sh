#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <immutable-image-reference> [rollback-source-directory]" >&2
  exit 2
fi

IMAGE_REFERENCE="$1"
ROLLBACK_SOURCE_DIR="${2:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="${ROOT_DIR}/release-evidence"
RUNTIME_DIR="${ROOT_DIR}/.staging-runtime"
COMPOSE=(docker compose -f "${ROOT_DIR}/docker-compose.yml")
CANARY_TOKEN='codestra-staging-canary-token-0000000000000001'
CANARY_TENANT='staging-canary'

capture_logs() {
  mkdir -p "${EVIDENCE_DIR}"
  "${COMPOSE[@]}" logs --no-color > "${EVIDENCE_DIR}/staging-compose.log" 2>&1 || true
}

cleanup() {
  capture_logs
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}" "${EVIDENCE_DIR}"

printf '%s' 'scrapper-staging-password' > "${RUNTIME_DIR}/postgres_password"
printf '%s' 'postgresql://scrapper:scrapper-staging-password@postgres:5432/scrapper' \
  > "${RUNTIME_DIR}/database_url"
printf '%s' 'staging-ein-pepper' > "${RUNTIME_DIR}/ein_fingerprint_pepper"
printf '%s' 'disabled-staging-hmac' > "${RUNTIME_DIR}/outbound_hmac"
printf '%s' 'disabled-staging-token' > "${RUNTIME_DIR}/middleware_token"
: > "${RUNTIME_DIR}/middleware_ca"
: > "${RUNTIME_DIR}/client_cert"
: > "${RUNTIME_DIR}/client_key"

TOKEN_SHA="$(printf '%s' "${CANARY_TOKEN}" | sha256sum | awk '{print $1}')"
cat > "${RUNTIME_DIR}/service_principals.json" <<EOF
{
  "principals": [
    {
      "clientId": "staging-canary",
      "tenantId": "${CANARY_TENANT}",
      "tokenSha256": "${TOKEN_SHA}",
      "scopes": ["jobs:write", "jobs:read", "results:read", "jobs:cancel", "operations:read"],
      "enabled": true
    }
  ]
}
EOF

cat > "${RUNTIME_DIR}/staging.env" <<'EOF'
NODE_ENV=staging
ENABLE_EXTERNAL_DELIVERY=false
ENABLE_REGISTRY_ENRICHMENT=false
MAX_JOB_COMPANIES=10
MAX_JOB_PAGES=25
MAX_JOB_RUNTIME_SECONDS=300
HTTP_CONCURRENCY=2
BROWSER_CONCURRENCY=1
JOB_CONCURRENCY=1
JOB_LEASE_SECONDS=180
JOB_HEARTBEAT_SECONDS=15
OUTBOX_LEASE_SECONDS=120
PER_HOST_REQUESTS_PER_SECOND=0.5
DATA_RETENTION_DAYS=7
RAW_PAGE_RETENTION_DAYS=1
EOF

export SCRAPPER_IMAGE="${IMAGE_REFERENCE}"
export SCRAPPER_ENV_FILE="${RUNTIME_DIR}/staging.env"
export DATABASE_URL_FILE="${RUNTIME_DIR}/database_url"
export POSTGRES_PASSWORD_FILE="${RUNTIME_DIR}/postgres_password"
export SERVICE_PRINCIPALS_FILE="${RUNTIME_DIR}/service_principals.json"
export EIN_FINGERPRINT_PEPPER_FILE="${RUNTIME_DIR}/ein_fingerprint_pepper"
export OUTBOUND_HMAC_SECRET_FILE="${RUNTIME_DIR}/outbound_hmac"
export OUTBOUND_BEARER_TOKEN_FILE="${RUNTIME_DIR}/middleware_token"
export OUTBOUND_CA_FILE="${RUNTIME_DIR}/middleware_ca"
export OUTBOUND_CLIENT_CERT_FILE="${RUNTIME_DIR}/client_cert"
export OUTBOUND_CLIENT_KEY_FILE="${RUNTIME_DIR}/client_key"
export SCRAPPER_BIND_PORT=3200

"${COMPOSE[@]}" up -d postgres redis
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --no-deps api crawl-worker delivery-worker

ready='false'
for _ in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:3200/readyz >/dev/null; then
    ready='true'
    break
  fi
  sleep 1
done
[[ "${ready}" == 'true' ]]

CAPABILITIES="$(curl --silent --fail \
  -H "authorization: Bearer ${CANARY_TOKEN}" \
  -H "x-tenant-id: ${CANARY_TENANT}" \
  http://127.0.0.1:3200/api/v2/capabilities)"
node -e "const v=JSON.parse(process.argv[1]); if(v.external_delivery_enabled!==false || v.registry_enrichment_enabled!==false) process.exit(1)" \
  "${CAPABILITIES}"

CORRELATION_ID="$(cat /proc/sys/kernel/random/uuid)"
IDEMPOTENCY_KEY="staging-canary-${CORRELATION_ID}"
CREATE_RESPONSE="$(curl --silent --fail --request POST \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${CANARY_TOKEN}" \
  -H "x-tenant-id: ${CANARY_TENANT}" \
  -H "x-correlation-id: ${CORRELATION_ID}" \
  -H "idempotency-key: ${IDEMPOTENCY_KEY}" \
  --data '{"seedUrls":["https://example.com/"],"profile":"company","mode":"single","browser":"http","maxPages":1,"maxCompanies":1,"maxDepth":0,"requestsPerSecond":0.5,"countryCode":"US"}' \
  http://127.0.0.1:3200/api/v2/jobs)"
JOB_ID="$(node -e "const v=JSON.parse(process.argv[1]); if(!v.id) process.exit(1); process.stdout.write(v.id)" "${CREATE_RESPONSE}")"

JOB_STATUS=''
JOB_RESPONSE=''
for _ in $(seq 1 90); do
  JOB_RESPONSE="$(curl --silent --fail \
    -H "authorization: Bearer ${CANARY_TOKEN}" \
    -H "x-tenant-id: ${CANARY_TENANT}" \
    "http://127.0.0.1:3200/api/v2/jobs/${JOB_ID}")"
  JOB_STATUS="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "${JOB_RESPONSE}")"
  case "${JOB_STATUS}" in
    completed) break ;;
    failed|cancelled)
      echo "Canary ended in ${JOB_STATUS}: ${JOB_RESPONSE}" >&2
      exit 1
      ;;
  esac
  sleep 2
done
[[ "${JOB_STATUS}" == 'completed' ]]

DELIVERY_EVIDENCE="$("${COMPOSE[@]}" exec -T postgres \
  psql -U scrapper -d scrapper -Atc \
  "select count(*) || ':' || coalesce(sum(attempts),0) || ':' || coalesce(string_agg(distinct status, ','),'') from outbox_events where tenant_id='${CANARY_TENANT}'")"
EVENT_COUNT="${DELIVERY_EVIDENCE%%:*}"
ATTEMPTS_AND_STATUS="${DELIVERY_EVIDENCE#*:}"
ATTEMPT_COUNT="${ATTEMPTS_AND_STATUS%%:*}"
EVENT_STATUSES="${ATTEMPTS_AND_STATUS#*:}"
[[ "${EVENT_COUNT}" -ge 1 ]]
[[ "${ATTEMPT_COUNT}" == '0' ]]
[[ "${EVENT_STATUSES}" == 'pending' ]]

MIGRATION_BEFORE="$("${COMPOSE[@]}" exec -T postgres \
  psql -U scrapper -d scrapper -Atc \
  "select string_agg(filename, ',' order by filename) from schema_migrations")"
ROLLBACK_STATUS='not_exercised'
MIGRATION_AFTER_ROLLBACK=''
MIGRATION_AFTER_RESTORE="${MIGRATION_BEFORE}"

if [[ -n "${ROLLBACK_SOURCE_DIR}" && -d "${ROLLBACK_SOURCE_DIR}" ]]; then
  "${COMPOSE[@]}" stop api crawl-worker delivery-worker
  "${COMPOSE[@]}" run --rm migrate node dist/migrate-down.js
  MIGRATION_AFTER_ROLLBACK="$("${COMPOSE[@]}" exec -T postgres \
    psql -U scrapper -d scrapper -Atc \
    "select string_agg(filename, ',' order by filename) from schema_migrations")"
  [[ "${MIGRATION_AFTER_ROLLBACK}" != *'003_runtime_leases.sql'* ]]

  docker build --tag codestra-scrapper:rollback "${ROLLBACK_SOURCE_DIR}"
  export SCRAPPER_IMAGE='codestra-scrapper:rollback'
  "${COMPOSE[@]}" up -d --no-deps api
  rollback_ready='false'
  for _ in $(seq 1 40); do
    if curl --silent --fail http://127.0.0.1:3200/readyz >/dev/null; then
      rollback_ready='true'
      break
    fi
    sleep 1
  done
  [[ "${rollback_ready}" == 'true' ]]

  "${COMPOSE[@]}" stop api
  export SCRAPPER_IMAGE="${IMAGE_REFERENCE}"
  "${COMPOSE[@]}" run --rm migrate
  MIGRATION_AFTER_RESTORE="$("${COMPOSE[@]}" exec -T postgres \
    psql -U scrapper -d scrapper -Atc \
    "select string_agg(filename, ',' order by filename) from schema_migrations")"
  [[ "${MIGRATION_AFTER_RESTORE}" == *'003_runtime_leases.sql'* ]]
  "${COMPOSE[@]}" up -d --no-deps api crawl-worker delivery-worker
  restored_ready='false'
  for _ in $(seq 1 40); do
    if curl --silent --fail http://127.0.0.1:3200/readyz >/dev/null; then
      restored_ready='true'
      break
    fi
    sleep 1
  done
  [[ "${restored_ready}" == 'true' ]]
  ROLLBACK_STATUS='pass'
fi

RESOLVED_IMAGE_ID="$(docker image inspect "${IMAGE_REFERENCE}" --format '{{.Id}}')"
cat > "${EVIDENCE_DIR}/staging-canary.json" <<EOF
{
  "image": "${IMAGE_REFERENCE}",
  "resolved_image_id": "${RESOLVED_IMAGE_ID}",
  "environment": "ephemeral-staging",
  "external_delivery_enabled": false,
  "registry_enrichment_enabled": false,
  "job_id": "${JOB_ID}",
  "job_status": "${JOB_STATUS}",
  "outbox_event_count": ${EVENT_COUNT},
  "outbox_delivery_attempts": ${ATTEMPT_COUNT},
  "outbox_statuses": "${EVENT_STATUSES}",
  "migrations_before": "${MIGRATION_BEFORE}",
  "migrations_after_rollback": "${MIGRATION_AFTER_ROLLBACK}",
  "migrations_after_restore": "${MIGRATION_AFTER_RESTORE}",
  "rollback_rehearsal": "${ROLLBACK_STATUS}",
  "production_activated": false
}
EOF
cat "${EVIDENCE_DIR}/staging-canary.json"
