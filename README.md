# Commander Link

Commander Link is a tiny parallel push-to-talk voice channel for commanders/leads who already use Discord as their main raid voice channel.

It is **not** a Discord replacement and **not** a general-purpose voice platform.

## Product model

- Discord stays open and carries the normal raid/squad communication.
- Commander Link provides a second, private, audio-only WebRTC mesh for up to 4 commanders.
- Desktop users can hold a global hotkey (default `F8`) to transmit while the game has focus.
- Browser users can hold a large on-screen push-to-talk button on a second display.
- Releasing the key/button must mute immediately.
- Browser and desktop clients join the same room via the same HTTPS invite URL.

## Architecture

```text
Browser React client ----\
                         +--> Cloudflare Worker / RoomGate DO --> scoped Metered Realtime JWT
Electron + React client -/
                                   |
                                   v
                     @metered-ca/realtime (MeteredPeer)
                     signalling + presence + TURN metadata
                                   |
                                   v
                     WebRTC audio-only P2P mesh (max. 4 peers)
                     TURN relay only as fallback
```

Cloudflare does **not** implement WebRTC signalling. The Durable Object only
protects room creation/join, expiration and the 4-peer admission limit. The
client renders against a provider-independent `VoiceTransport` interface;
`MeteredPeer` lives behind `MeteredRealtimeTransport`.

Every Commander Link room maps deterministically to a Realtime channel:
`commander-link/<room-id>`. Tokens are scoped to exactly that one channel.

## Security invariants

1. Metered secret credentials (`sk_id` / `sk_secret`) never ship to clients.
2. Clients receive short-lived, channel-scoped JWTs only (minted server-side).
3. Only server-created room IDs are accepted.
4. Maximum admitted peers per room is 4.
5. Rooms expire automatically (default 6 hours).
6. Media is audio-only in the official client.
7. All PTT failure paths fail closed to muted.
8. No recording, transcription, bots, video or screen sharing in MVP.

## Monorepo

- `apps/web` — React/Vite browser app and shared renderer UI.
- `apps/desktop` — Electron main/preload shell, deep links and global PTT.
- `apps/worker` — Cloudflare Worker + one SQLite-backed Durable Object per room.
- `packages/core` — shared types, room/API contracts and PTT state machine.
- `docs/` — product, architecture, security, networking and acceptance criteria.
- `AGENTS.md` — binding Codex implementation instructions.
- `TASKS.md` — ordered implementation plan. Codex should work top-to-bottom.

## Primary user journey

1. A commander creates a room.
2. The service returns an invite like `https://voice.example.org/r/<room-id>`.
3. Other commanders open the same link in browser, or choose **Open in desktop app**.
4. Electron receives a deep link such as `commanderlink://join/<room-id>`.
5. Each client asks the Worker for a scoped Realtime JWT.
6. `MeteredPeer` joins the room's channel, connects peers P2P and auto-injects TURN.
7. Everyone starts muted.
8. Hold F8 (desktop) or hold the red button (browser) to transmit.
9. Release means mute immediately.

## Status

This repository intentionally contains the architecture, contracts, scaffolding and Codex execution plan. `TASKS.md` defines what must be completed before release. Do not claim production-readiness until every MVP acceptance criterion passes.

## Running locally

Prerequisites: Node.js 22+, pnpm 10, and a Metered account with **Realtime Messaging** enabled (a `sk_id` + `sk_secret` key pair from Dashboard → Realtime Messaging → Keys, and a TURN service active for TURN fallback).

```powershell
# 1. Install
pnpm install

# 2. Configure the Worker secrets (never commit them)
cd apps/worker
wrangler secret put METERED_REALTIME_KEY_ID    # sk_id_...
wrangler secret put METERED_REALTIME_SECRET    # sk_secret_...
cd ../..

# 3. Run the API (Worker) and the web app in two terminals
pnpm dev:worker    # http://localhost:8788
pnpm dev:web       # http://localhost:5173

# 4. Optional: run the desktop shell (loads the web app, adds global F8 + deep links)
pnpm dev:desktop
```

For `wrangler dev`, put secrets in `apps/worker/.dev.vars`:

```ini
METERED_REALTIME_KEY_ID=sk_id_...
METERED_REALTIME_SECRET=sk_secret_...
```

Open `http://localhost:5173`, create a room, then open the invite in a second window to talk.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | web build env | Worker base URL (default `http://localhost:8788`). |
| `METERED_REALTIME_KEY_ID` | Worker **secret** | Metered Realtime key id (`sk_id_…`). Server-side token minting. Never exposed to clients. |
| `METERED_REALTIME_SECRET` | Worker **secret** | Metered Realtime signing secret (`sk_secret_…`). Never exposed to clients. |
| `APP_ORIGIN` | Worker `[vars]` | CORS allowlist + invite origin. |
| `ROOM_TTL_SECONDS` | Worker `[vars]` | Room lifetime (default 21600 = 6h). |
| `TOKEN_TTL_SECONDS` | Worker `[vars]` | Minted Realtime JWT lifetime (default 3600 = 1h). |
| `MAX_ROOM_PEERS` | Worker `[vars]` | Hard admission cap (default 4). |

## Deployment

- **Worker/API:** `cd apps/worker && wrangler deploy`. Set
  `METERED_REALTIME_KEY_ID` and `METERED_REALTIME_SECRET` via `wrangler secret
  put`, and `APP_ORIGIN` in `wrangler.toml`.
- **Web:** `pnpm --filter @commander-link/web build` → deploy `apps/web/dist` to any static host.
  A SPA fallback (`/* → /index.html`) is required so `/r/<room-id>` resolves; a Cloudflare Pages
  `_redirects` file is included.
- **Desktop:** `pnpm --filter @commander-link/desktop build`, then package with your Electron
  packager. The app registers the `commanderlink://` protocol on Windows/Linux.

## Deep links & the desktop app

- Primary invite is always HTTPS `/r/<room-id>` so a browser is a valid fallback.
- The desktop app registers `commanderlink://join/<room-id>` and routes second launches into the
  existing window (single instance).
- Global push-to-talk uses a native key hook (`uiohook-napi`) so **F8 hold/release works while the
  game or another app has focus** — something `globalShortcut` cannot do (no key-up event).

## Steam Deck / Linux notes

Global key capture under Wayland is restricted. On X11 (Steam Deck Desktop Mode / gaming mode via
`uiohook`) F8 capture generally works; under strict Wayland compositors it may not. The browser
build with the large on-screen hold-to-talk button is the guaranteed fallback on any platform.

## Troubleshooting

### Join fails with `token_minting_failed` (502)

The Worker could not mint a Metered Realtime JWT. `wrangler dev` logs the safe
reason code (`console.error`); the join response carries it as `reason`:

| `reason` | Meaning |
| --- | --- |
| `missing_credentials` | `METERED_REALTIME_KEY_ID`/`METERED_REALTIME_SECRET` are not set at all in the Worker environment (`.dev.vars` for `wrangler dev`, `wrangler secret`s for deploy). |
| `placeholder_credentials` | The values are still `sk_id_replace-me`/`sk_secret_replace-me`. Use a real `sk_id_…`/`sk_secret_…` pair from Dashboard → Realtime Messaging → Keys. |
| `unauthorized` | The key pair values are wrong/invalid. |
| `channel_not_authorized` | The Realtime key's `channelPatterns` do not allow `commander-link/*`. |
| `action_not_permitted` | The key's action set is missing one of `publish`/`subscribe`/`presence`/`send` (all four are required for WebRTC negotiation). |
| `provider_unreachable` | The Worker could not reach `rms.metered.ca` (network/egress). |

Quick check of your credentials outside the app:

```powershell
$body = '{"peerId":"probe","channels":["commander-link/probe"],"permissions":["publish","subscribe","presence","send"],"expiresInSec":3600}'
Invoke-RestMethod -Uri "https://rms.metered.ca/v1/tokens" -Method POST -Headers @{Authorization="Bearer sk_id_YOURS:sk_secret_YOURS"} -ContentType "application/json" -Body $body
```

A `token` in the response means the credentials and channel scope are valid.

### pnpm install / native binaries
Bei einem frischen pnpm install (neuer Clone / CI) greift der Eintrag pnpm.onlyBuiltDependencies in der Root-package.json und lädt die Binaries automatisch. Falls pnpm die Build-Skripte trotzdem mal blockiert, hilft:

```
Electron: node node_modules/.pnpm/electron@<version>/node_modules/electron/install.js
uiohook: pnpm rebuild uiohook-napi
oder generell pnpm approve-builds
```

## Privacy

Audio only. No recording, no transcription, no chat, no video, no accounts in the MVP.

