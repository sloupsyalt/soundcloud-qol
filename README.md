# SoundCloud QoL

Chrome extension with QoL extras for [soundcloud.com](https://soundcloud.com). No ad blocking, no premium unlocks.

Black & white UI that sits in the player chrome.

## Features

- **Sleep timer** — presets, custom minutes, or stop after the current track
- **Playback speed** — 0.75x–2x
- **Loop** — repeat the current track
- **Mute** — toggle audio from the player bar
- **Focus mode** — quieter layout
- **Copy track** — `C` for link · `Shift+C` with timestamp
- **Recent tracks** — last plays in the extension popup
- **Keyboard shortcuts** — press `?` on SoundCloud
- **Discord Rich Presence** — title, artist, cover art (local bridge)
- **EN / FR** UI

## Install (Chrome)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`soundcloud-qol`)
5. After updates, hit **Reload** on the extension card

## Discord presence

Discord rejects WebSocket connections from browser extensions (`Invalid Origin`). A tiny local bridge uses Discord’s IPC instead.

### Architecture & security

```
SoundCloud tab → content script → extension service worker
                                      ↓ HTTP (127.0.0.1 only)
                                 local bridge → Discord IPC
```

The bridge:

- Listens only on `127.0.0.1:19234`
- Requires a **per-install auth token** on every request (`Authorization: Bearer …`)
- Allows CORS only for `chrome-extension://…` origins (not `*`)
- Rejects bodies larger than 64 KB
- Exposes a minimal `/health` payload (`ok`, `rpcReady`) — no client ID or track details
- Validates / truncates every track field before building presence

`bridge/config.json` is created locally (gitignored) and holds `authToken` + Discord app settings. Paste the token into **extension Settings → Bridge auth token** (stored in `chrome.storage.local` only).

### macOS (autostart)

1. Double-click `bridge/install-autostart.command`
2. Copy the printed token into extension Settings
3. Open Discord desktop and play a track

- Logs: `~/Library/Logs/soundcloud-qol-bridge.log`
- Uninstall: `bridge/uninstall-autostart.command`
- Manual run: `bridge/start.command`

### Windows / Linux (manual)

Bridge autostart scripts are **macOS-only** today. On Windows or Linux:

1. Install [Node.js](https://nodejs.org/)
2. In `bridge/`: `npm install` then `npm start` (or `node server.js`)
3. Keep that process running while you use Discord presence
4. Copy `authToken` from `bridge/config.json` into extension Settings

Upload a Rich Presence art asset named `soundcloud` in the Discord Developer Portal. Presence buttons are only visible to other users, not on your own profile.

## Shortcuts (on SoundCloud)

| Key | Action |
|-----|--------|
| `T` | Sleep timer |
| `E` | Stop after this track |
| `F` | Focus mode |
| `L` | Loop track |
| `M` | Mute |
| `C` | Copy now playing |
| `⇧C` | Copy with timestamp |
| `[` / `]` | Seek −10s / +10s |
| `-` / `=` | Slower / faster |
| `?` | Help |

## Privacy

- Runs only on SoundCloud pages
- Discord traffic stays on your machine (extension → local bridge → Discord IPC)
- No analytics, no accounts, no remote servers of ours
- Bridge auth token never syncs via Chrome sync

## License

MIT — see [LICENSE](LICENSE)
