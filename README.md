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

## Discord presence (auto-start bridge)

Discord rejects WebSocket connections from browser extensions (`Invalid Origin`). A tiny local bridge uses Discord’s IPC instead.

**One-time setup (macOS):** double-click `bridge/install-autostart.command`  
→ starts at login, restarts if it crashes, no terminal window needed.

- Logs: `~/Library/Logs/soundcloud-qol-bridge.log`
- Uninstall: `bridge/uninstall-autostart.command`
- Manual run: `bridge/start.command`

Then play on SoundCloud with Discord desktop open.

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
