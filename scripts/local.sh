#!/usr/bin/env bash
# One-command local development: ./scripts/local.sh
# Loads .env and apps/server/.env, finds free ports, then builds and starts both apps.
# Vite loads apps/web/.env itself. Ctrl-C stops the launched stack.
set -euo pipefail

if [ "$#" -gt 0 ]; then
  echo "Usage: ./scripts/local.sh (no arguments; configure settings in .env files)"
  case "$1" in -h|--help) exit 0 ;; *) exit 2 ;; esac
fi

LOCAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$LOCAL_ROOT"

# These are trusted local shell-compatible env files, just as in the manual launch command.
set -a
for env_file in .env apps/server/.env; do
  if [ -f "$env_file" ]; then
    source "$env_file"
  fi
done
set +a

command -v lsof >/dev/null 2>&1 || {
  echo "[local] lsof is required to find free IPv4 and IPv6 ports." >&2
  exit 1
}
# shellcheck source=lib/demo-ports.sh
source "$LOCAL_ROOT/scripts/lib/demo-ports.sh"

find_free_port() {
  local port="$1" label="$2" reserved="${3:-0}" last
  if [[ ! "$port" =~ ^[0-9]{1,5}$ ]]; then
    echo "[local] $label must be an integer in [1, 65535]." >&2
    return 1
  fi
  port=$((10#$port))
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "[local] $label must be an integer in [1, 65535]." >&2
    return 1
  fi
  last=$((port + 100))
  while [ "$port" -le 65535 ] && [ "$port" -lt "$last" ]; do
    if [ "$port" != "$reserved" ] && [ -z "$(list_port_listeners "$port")" ]; then
      echo "$port"
      return 0
    fi
    echo "[local] Port $port is occupied or reserved; trying the next port." >&2
    port=$((port + 1))
  done
  echo "[local] No free port found for $label; choose another starting port in your .env." >&2
  return 1
}

PORT="$(find_free_port "${PORT:-3000}" PORT)"
WEB_PORT="$(find_free_port "${WEB_PORT:-5173}" WEB_PORT "$PORT")"
EMBER_SERVER_PORT="$PORT"
export PORT WEB_PORT EMBER_SERVER_PORT

# Local mode always creates a fresh incident via the selected server.
export VITE_INCIDENT_REST_BASE_URL=""
export VITE_INCIDENT_WS_URL=""
export VITE_INCIDENT_ID=""
export VITE_INCIDENT_TOKEN=""

echo "[local] Server: http://127.0.0.1:$PORT"
echo "[local] Open http://127.0.0.1:$WEB_PORT/ once the demo reports ready."
exec bash "$LOCAL_ROOT/scripts/demo.sh"
