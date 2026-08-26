#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="${ROOT_DIR}/deploy/gateway"
CERT_DIR="${GATEWAY_DIR}/.certs"
COMPOSE=(docker compose -f "${GATEWAY_DIR}/docker-compose.validation.yml")
EVIDENCE_DIR="${ROOT_DIR}/release-evidence"

cleanup() {
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

rm -rf "${CERT_DIR}"
mkdir -p "${CERT_DIR}" "${EVIDENCE_DIR}"

openssl genrsa -out "${CERT_DIR}/ca.key" 2048 >/dev/null 2>&1
openssl req -x509 -new -nodes -key "${CERT_DIR}/ca.key" -sha256 -days 2 \
  -subj '/CN=Codestra Gateway Validation CA' -out "${CERT_DIR}/ca.crt" >/dev/null 2>&1

openssl genrsa -out "${CERT_DIR}/server.key" 2048 >/dev/null 2>&1
openssl req -new -key "${CERT_DIR}/server.key" -subj '/CN=localhost' \
  -out "${CERT_DIR}/server.csr" >/dev/null 2>&1
cat > "${CERT_DIR}/server.ext" <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in "${CERT_DIR}/server.csr" -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" -CAcreateserial -out "${CERT_DIR}/server.crt" \
  -days 2 -sha256 -extfile "${CERT_DIR}/server.ext" >/dev/null 2>&1

openssl genrsa -out "${CERT_DIR}/client.key" 2048 >/dev/null 2>&1
openssl req -new -key "${CERT_DIR}/client.key" -subj '/CN=codestra-validation-client' \
  -out "${CERT_DIR}/client.csr" >/dev/null 2>&1
cat > "${CERT_DIR}/client.ext" <<'EOF'
extendedKeyUsage=clientAuth
EOF
openssl x509 -req -in "${CERT_DIR}/client.csr" -CA "${CERT_DIR}/ca.crt" \
  -CAkey "${CERT_DIR}/ca.key" -CAcreateserial -out "${CERT_DIR}/client.crt" \
  -days 2 -sha256 -extfile "${CERT_DIR}/client.ext" >/dev/null 2>&1

openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=rogue-client' \
  -keyout "${CERT_DIR}/rogue.key" -out "${CERT_DIR}/rogue.crt" >/dev/null 2>&1
chmod 0644 "${CERT_DIR}"/*.crt
chmod 0600 "${CERT_DIR}"/*.key

"${COMPOSE[@]}" up -d mock-api kong caddy

for _ in $(seq 1 40); do
  if curl --silent --fail --max-time 3 \
    --cacert "${CERT_DIR}/ca.crt" \
    --cert "${CERT_DIR}/client.crt" \
    --key "${CERT_DIR}/client.key" \
    -H 'x-client-id: gateway-ready' \
    https://localhost:8443/api/v2/health >/dev/null; then
    break
  fi
  sleep 1
done

if curl --silent --insecure --max-time 3 \
  https://localhost:8443/api/v2/health >/dev/null 2>&1; then
  echo 'ERROR: Caddy accepted a request without a client certificate' >&2
  exit 1
fi

if curl --silent --insecure --max-time 3 \
  --cert "${CERT_DIR}/rogue.crt" --key "${CERT_DIR}/rogue.key" \
  https://localhost:8443/api/v2/health >/dev/null 2>&1; then
  echo 'ERROR: Caddy accepted an untrusted client certificate' >&2
  exit 1
fi

trusted_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cacert "${CERT_DIR}/ca.crt" \
  --cert "${CERT_DIR}/client.crt" \
  --key "${CERT_DIR}/client.key" \
  -H 'x-client-id: trusted-client' \
  https://localhost:8443/api/v2/health)"
[[ "${trusted_status}" == '200' ]]

outside_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cacert "${CERT_DIR}/ca.crt" \
  --cert "${CERT_DIR}/client.crt" \
  --key "${CERT_DIR}/client.key" \
  https://localhost:8443/private-admin)"
[[ "${outside_status}" == '404' ]]

rate_codes=()
for _ in $(seq 1 6); do
  rate_codes+=("$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --cacert "${CERT_DIR}/ca.crt" \
    --cert "${CERT_DIR}/client.crt" \
    --key "${CERT_DIR}/client.key" \
    -H 'x-client-id: rate-limit-test' \
    https://localhost:8443/api/v2/health)")
done
if [[ " ${rate_codes[*]} " != *' 429 '* ]]; then
  echo "ERROR: Kong rate limiting did not produce 429: ${rate_codes[*]}" >&2
  exit 1
fi

attacker_status="$("${COMPOSE[@]}" run --rm --no-deps attacker \
  --silent --output /dev/null --write-out '%{http_code}' \
  http://kong:8000/api/v2/health)"
[[ "${attacker_status}" == '403' ]]

if "${COMPOSE[@]}" port kong 8000 | grep -q .; then
  echo 'ERROR: Kong proxy port is published to the host' >&2
  exit 1
fi

cat > "${EVIDENCE_DIR}/gateway-validation.json" <<EOF
{
  "tls_server_validation": "pass",
  "mtls_required": "pass",
  "untrusted_client_rejected": "pass",
  "kong_caddy_route": "pass",
  "private_path_denied": "pass",
  "rate_limit_429": "pass",
  "kong_ip_allowlist": "pass",
  "kong_not_host_published": "pass",
  "external_delivery_enabled": false
}
EOF

cat "${EVIDENCE_DIR}/gateway-validation.json"
