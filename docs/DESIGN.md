# Design system — SoundCloud QoL

Compact audio-utility UI. Dark charcoal surfaces, SoundCloud orange used sparingly.

## Tokens (`shared/tokens.css`)

| Token | Role |
|-------|------|
| `--qol-bg` / `--qol-surface` / `--qol-surface-2` | Page / panel / hover surfaces |
| `--qol-ink` / `--qol-ink-muted` / `--qol-ink-faint` | Text hierarchy |
| `--qol-accent` | Active controls, primary actions, focus ring |
| `--qol-success` / `--qol-warn` / `--qol-danger` | Status (never color-only) |
| `--qol-radius-sm` / `--qol-radius` | 3px / 5px corners |
| `--qol-space-*` | 4 / 8 / 12 / 16 / 20 spacing scale |
| `--qol-hit` | 32px minimum control target |
| `--qol-font` / `--qol-mono` | System stacks (no webfonts) |
| `--qol-ease` | Short transitions; disabled under `prefers-reduced-motion` |

## Components

- **Header** — brand mark + title + version + settings icon
- **Now playing** — art, title, artist, time, thin progress, live dot / empty state
- **Chip row** — timer presets
- **Segmented control** — playback speed
- **Action grid** — icon+label quick actions; `aria-pressed` for toggles
- **Inline feedback** — copy confirmation (no modal)
- **RPC legacy block** — preserved Discord status + reconnect (do not restyle)
- **Recent list** — art + title + artist + relative time
- **Footer** — status · GitHub · version
- **Injected toolbar** — compact player-bar buttons; orange active; overflow on narrow widths
- **Settings shell** — sticky left nav (stacked on small screens); synced vs local badges

## States

Default · Hover · Pressed · Focus-visible (orange ring) · Disabled · Loading (status text) · Success (inline) · Error (inline) · Empty · Disconnected (RPC legacy) · Timer active · Focus active
