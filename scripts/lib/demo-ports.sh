# Shared port checks for scripts/demo.sh (source, do not execute directly).
# Fails if anything listens on the port on IPv4 or IPv6 — strictPort on 127.0.0.1 alone
# does not evict a stale [::1] listener, which breaks http://localhost/ on macOS.

list_port_listeners() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true
  fi
}

require_port_free() {
  local port="$1" label="$2"
  local out
  out="$(list_port_listeners "$port")"
  if [ -n "$out" ]; then
    printf '\033[1;31m[demo]\033[0m error: %s port %s already in use (IPv4 and/or IPv6):\n' "$label" "$port" >&2
    echo "$out" >&2
    echo "[demo] Stop the stale process, or use another port (PORT / WEB_PORT)." >&2
    echo "[demo] If a mock Vite is on [::1], open http://127.0.0.1:${port}/ for the live stack." >&2
    return 1
  fi
  return 0
}
