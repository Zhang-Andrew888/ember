#!/usr/bin/env bash
# Launch Ember Line for a demo or a smoke test.
#
#   scripts/demo.sh              # live mode: server on :3000 + web on :5173 wired together
#   scripts/demo.sh mock         # web only, in-browser mock socket (no server)
#   scripts/demo.sh --smoke      # live mode, run scripts/smoke.mjs against it, then exit
#   scripts/demo.sh --no-web     # server only (useful with a separately started web dev server)
#   scripts/demo.sh --comparison  # print held-out aggregates for the demo pitch (no server)
#
# Environment:
#   PORT       server port (default 3000; the web dev server proxy expects 3000)
#   WEB_PORT   vite port   (default 5173)
#   SKIP_BUILD set to 1 to skip `pnpm build:libs` (workspace packages resolve from dist/)
#
# Ctrl-C stops everything that was started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/demo-ports.sh
source "$ROOT/scripts/lib/demo-ports.sh"

MODE="live"
SMOKE=0
START_WEB=1
COMPARISON=0
for arg in "$@"; do
  case "$arg" in
    mock) MODE="mock" ;;
    live) MODE="live" ;;
    --smoke) SMOKE=1 ;;
    --no-web) START_WEB=0 ;;
    --comparison) COMPARISON=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$COMPARISON" = "1" ]; then
  exec node "$ROOT/scripts/demo-comparison.mjs"
fi

PORT="${PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"
LOG_DIR="${LOG_DIR:-/tmp/ember-demo}"
mkdir -p "$LOG_DIR"

PIDS=()
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT INT TERM

log() { printf '\033[1;33m[demo]\033[0m %s\n' "$*"; }

command -v pnpm >/dev/null || { echo "pnpm is required (corepack enable && corepack prepare pnpm@10 --activate)" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node >= 22 is required (found $(node -v))" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  log "installing dependencies"
  pnpm install --frozen-lockfile
fi

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  # apps/server imports workspace packages through their dist/ entry points.
  log "building workspace libraries"
  pnpm build:libs >"$LOG_DIR/build-libs.log" 2>&1 || { cat "$LOG_DIR/build-libs.log"; exit 1; }
fi

wait_for_http() {
  local url="$1" name="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "$name did not become ready at $url" >&2
  return 1
}

if [ "$MODE" = "live" ]; then
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    log "a server is already listening on :$PORT; reusing it"
  else
    require_port_free "$PORT" "server"
    log "starting server on :$PORT (log: $LOG_DIR/server.log)"
    PORT="$PORT" pnpm --filter ember-server exec tsx src/main.ts >"$LOG_DIR/server.log" 2>&1 &
    PIDS+=("$!")
    wait_for_http "http://127.0.0.1:$PORT/health" "server" || { cat "$LOG_DIR/server.log"; exit 1; }
  fi
  log "server healthy: $(curl -fsS "http://127.0.0.1:$PORT/health")"
fi

if [ "$START_WEB" = "1" ]; then
  require_port_free "$WEB_PORT" "web"
  log "starting web on :$WEB_PORT in $MODE mode (log: $LOG_DIR/web.log)"
  # Bind IPv4 explicitly: vite's default "localhost" may resolve to ::1 only, which breaks 127.0.0.1 probes.
  if [ "$MODE" = "live" ]; then
    # Any value (even empty) switches App.tsx from the mock socket to POST /incidents via the vite proxy.
    VITE_INCIDENT_REST_BASE_URL="" pnpm --filter ember-web exec vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort >"$LOG_DIR/web.log" 2>&1 &
  else
    pnpm --filter ember-web exec vite --host 127.0.0.1 --port "$WEB_PORT" --strictPort >"$LOG_DIR/web.log" 2>&1 &
  fi
  PIDS+=("$!")
  wait_for_http "http://127.0.0.1:$WEB_PORT/" "web" || { cat "$LOG_DIR/web.log"; exit 1; }
  log "web ready: http://127.0.0.1:$WEB_PORT/ (use this URL — localhost may hit a stale [::1] listener)"
fi

if [ "$SMOKE" = "1" ]; then
  log "running smoke test"
  SERVER_URL="http://127.0.0.1:$PORT" WEB_URL="$([ "$START_WEB" = "1" ] && echo "http://127.0.0.1:$WEB_PORT" || echo "")" \
    node scripts/smoke.mjs
  exit $?
fi

log "ready. Press Ctrl-C to stop."
wait
