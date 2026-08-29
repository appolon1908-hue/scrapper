#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

runtime_root="${1:?runtime root is required}"
runtime_env_file="${2:?runtime environment file is required}"
runtime_secrets_root="${3:?runtime secrets root is required}"
expected_api_port="${4:?expected API port is required}"

validate_path() {
  local label="$1"
  local value="$2"

  if [[ ! "$value" =~ ^/[A-Za-z0-9._/-]+$ ]]; then
    echo "ERROR=${label}_MUST_BE_AN_ABSOLUTE_SAFE_PATH" >&2
    exit 2
  fi
  if [[ "$value" == "/" || "$value" == *"//"* || "$value" == *"/../"* || "$value" == *"/./"* || "$value" == */.. || "$value" == */. ]]; then
    echo "ERROR=${label}_IS_UNSAFE" >&2
    exit 2
  fi
}

validate_path RUNTIME_ROOT "$runtime_root"
validate_path RUNTIME_ENV_FILE "$runtime_env_file"
validate_path RUNTIME_SECRETS_ROOT "$runtime_secrets_root"
if [[ ! "$expected_api_port" =~ ^[0-9]{1,5}$ ]] || (( expected_api_port < 1 || expected_api_port > 65535 )); then
  echo "ERROR=EXPECTED_API_PORT_IS_INVALID" >&2
  exit 2
fi

canonical() {
  readlink -m -- "$1"
}

state_of() {
  local path="$1"
  if [[ -L "$path" ]]; then
    printf 'symlink'
  elif [[ -d "$path" ]]; then
    printf 'directory'
  elif [[ -f "$path" ]]; then
    printf 'file'
  elif [[ -e "$path" ]]; then
    printf 'other'
  else
    printf 'missing'
  fi
}

metadata_of() {
  local path="$1"
  if [[ -e "$path" && ! -L "$path" ]]; then
    stat -Lc '%d:%i:%u:%g:%a:%F' -- "$path"
  else
    printf 'none'
  fi
}

nearest_existing_ancestor() {
  local path="$1"
  while [[ ! -e "$path" && "$path" != "/" ]]; do
    path="$(dirname -- "$path")"
  done
  canonical "$path"
}

flag_value() {
  local file="$1"
  local key="$2"
  local count value

  if [[ ! -r "$file" || -L "$file" ]]; then
    printf 'unavailable'
    return
  fi

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
    printf 'ambiguous'
    return
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
  case "$value" in
    true|false) printf '%s' "$value" ;;
    *) printf 'invalid' ;;
  esac
}

hash_if_regular() {
  local path="$1"
  if [[ -f "$path" && ! -L "$path" ]]; then
    sha256sum -- "$path" | awk '{print $1}'
  else
    printf 'missing'
  fi
}

exists_regular() {
  local path="$1"
  if [[ -f "$path" && ! -L "$path" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

machine_identity="$(
  if [[ -r /etc/machine-id ]]; then
    cat /etc/machine-id
  elif [[ -r /var/lib/dbus/machine-id ]]; then
    cat /var/lib/dbus/machine-id
  else
    hostname
  fi
)"
machine_fingerprint="$(printf '%s' "$machine_identity" | sha256sum | awk '{print $1}')"

root_canonical="$(canonical "$runtime_root")"
env_canonical="$(canonical "$runtime_env_file")"
secrets_canonical="$(canonical "$runtime_secrets_root")"
root_state="$(state_of "$runtime_root")"
env_state="$(state_of "$runtime_env_file")"
secrets_state="$(state_of "$runtime_secrets_root")"
root_ancestor="$(nearest_existing_ancestor "$runtime_root")"
env_ancestor="$(nearest_existing_ancestor "$runtime_env_file")"
secrets_ancestor="$(nearest_existing_ancestor "$runtime_secrets_root")"
external_delivery="$(flag_value "$runtime_env_file" ENABLE_EXTERNAL_DELIVERY)"
registry_enrichment="$(flag_value "$runtime_env_file" ENABLE_REGISTRY_ENRICHMENT)"

required_secrets=(
  database_url
  postgres_password
  service_principals.json
  ein_fingerprint_pepper
  outbound_hmac
  middleware_token
  middleware_ca
  client_cert
  client_key
  integration_client_ca.pem
)

missing_secret_count=0
for secret_name in "${required_secrets[@]}"; do
  if [[ "$(exists_regular "$runtime_secrets_root/$secret_name")" != "true" ]]; then
    missing_secret_count=$((missing_secret_count + 1))
  fi
done

ready=false
if [[ "$root_state" == "directory" &&
      "$env_state" == "file" &&
      "$secrets_state" == "directory" &&
      "$external_delivery" == "false" &&
      "$registry_enrichment" == "false" &&
      "$missing_secret_count" == "0" ]]; then
  ready=true
fi

echo "BEGIN_CONTRACT"
echo "schema_version=1"
echo "machine_fingerprint=$machine_fingerprint"
echo "runtime_root_input=$runtime_root"
echo "runtime_root_canonical=$root_canonical"
echo "runtime_root_state=$root_state"
echo "runtime_root_metadata=$(metadata_of "$runtime_root")"
echo "runtime_root_ancestor=$root_ancestor"
echo "runtime_root_ancestor_metadata=$(metadata_of "$root_ancestor")"
echo "runtime_env_file_input=$runtime_env_file"
echo "runtime_env_file_canonical=$env_canonical"
echo "runtime_env_file_state=$env_state"
echo "runtime_env_file_metadata=$(metadata_of "$runtime_env_file")"
echo "runtime_env_file_ancestor=$env_ancestor"
echo "runtime_env_file_ancestor_metadata=$(metadata_of "$env_ancestor")"
echo "runtime_secrets_root_input=$runtime_secrets_root"
echo "runtime_secrets_root_canonical=$secrets_canonical"
echo "runtime_secrets_root_state=$secrets_state"
echo "runtime_secrets_root_metadata=$(metadata_of "$runtime_secrets_root")"
echo "runtime_secrets_root_ancestor=$secrets_ancestor"
echo "runtime_secrets_root_ancestor_metadata=$(metadata_of "$secrets_ancestor")"
echo "external_delivery=$external_delivery"
echo "registry_enrichment=$registry_enrichment"
echo "required_secret_files_missing=$missing_secret_count"
echo "expected_api_port=$expected_api_port"
echo "docker_compose_sha256=$(hash_if_regular "$runtime_root/docker-compose.yml")"
echo "staging_overlay_sha256=$(hash_if_regular "$runtime_root/deploy/docker-compose.staging.yml")"
echo "caddy_config_sha256=$(hash_if_regular "$runtime_root/deploy/caddy/Caddyfile")"
echo "kong_config_sha256=$(hash_if_regular "$runtime_root/deploy/kong/kong.yml")"
echo "current_image_state=$(state_of "$runtime_root/.current_image")"
echo "current_image_sha256=$(hash_if_regular "$runtime_root/.current_image")"
echo "ready_for_write_disabled_deploy=$ready"
echo "END_CONTRACT"

port_listening=false
if command -v ss >/dev/null 2>&1; then
  if ss -H -lnt 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$expected_api_port$"; then
    port_listening=true
  fi
fi

docker_access=false
docker_compose_access=false
docker_version=unavailable
compose_version=unavailable
if command -v docker >/dev/null 2>&1; then
  if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    docker_access=true
    docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null | tr -cd 'A-Za-z0-9._+-')"
  fi
  if docker compose version --short >/dev/null 2>&1; then
    docker_compose_access=true
    compose_version="$(docker compose version --short 2>/dev/null | tr -cd 'A-Za-z0-9._+-')"
  fi
fi

service_state() {
  local unit="$1"
  local state
  if command -v systemctl >/dev/null 2>&1; then
    state="$(systemctl is-active "$unit" 2>/dev/null || true)"
    printf '%s' "${state:-unknown}"
  else
    printf 'unavailable'
  fi
}

host_name="$(hostname -f 2>/dev/null || hostname)"
echo "BEGIN_OBSERVATIONS"
echo "hostname_sha256=$(printf '%s' "$host_name" | sha256sum | awk '{print $1}')" 
echo "docker_access=$docker_access"
echo "docker_version=$docker_version"
echo "docker_compose_access=$docker_compose_access"
echo "docker_compose_version=$compose_version"
echo "expected_api_port_listening=$port_listening"
echo "docker_service=$(service_state docker)"
echo "caddy_service=$(service_state caddy)"
echo "nginx_service=$(service_state nginx)"
echo "kong_service=$(service_state kong)"
echo "END_OBSERVATIONS"
