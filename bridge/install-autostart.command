#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.soundcloudqol.bridge"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
LOG_OUT="$LOG_DIR/soundcloud-qol-bridge.log"
LOG_ERR="$LOG_DIR/soundcloud-qol-bridge.err.log"

chmod +x "$ROOT/run.sh" "$ROOT/start.command" "$ROOT/install-autostart.command" "$ROOT/uninstall-autostart.command" 2>/dev/null || true

if [ ! -d "$ROOT/node_modules" ]; then
  echo "Installing bridge dependencies…"
  npm install --prefix "$ROOT"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Could not find node. Install Node.js first."
  exit 1
fi

if [ ! -f "$ROOT/config.json" ] && [ -f "$ROOT/config.example.json" ]; then
  cp "$ROOT/config.example.json" "$ROOT/config.json"
  chmod 600 "$ROOT/config.json" 2>/dev/null || true
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/run.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true

sleep 1.5
if curl -sf "http://127.0.0.1:19234/health" >/dev/null; then
  echo "✓ Bridge autostart installed and running."
  echo "  Starts at login, restarts if it crashes."
  echo "  Logs: $LOG_OUT"
else
  echo "Autostart installed. Bridge may still be starting — check:"
  echo "  $LOG_ERR"
  echo "  $LOG_OUT"
fi
