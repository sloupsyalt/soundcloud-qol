#!/bin/bash
set -euo pipefail
LABEL="com.soundcloudqol.bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"

# Stop any leftover bridge on the port
PIDS="$(lsof -t -iTCP:19234 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "${PIDS}" ]; then
  kill $PIDS 2>/dev/null || true
fi

echo "✓ Bridge autostart removed."
