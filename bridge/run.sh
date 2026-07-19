#!/bin/bash
# Entrypoint used by LaunchAgent / start scripts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[bridge] node not found in PATH" >&2
  exit 1
fi

if [ ! -d "$ROOT/node_modules" ]; then
  echo "[bridge] installing dependencies…"
  npm install --prefix "$ROOT"
fi

# If something else already owns the port, exit quietly (LaunchAgent will retry)
if lsof -nP -iTCP:19234 -sTCP:LISTEN >/dev/null 2>&1; then
  # Prefer our own process; if foreign, still exit so we don't crash-loop hard
  echo "[bridge] port 19234 already in use — assuming bridge is up"
  exit 0
fi

exec "$NODE_BIN" "$ROOT/server.js"
