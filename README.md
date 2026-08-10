# Commander Link

Commander Link is a tiny parallel push-to-talk voice channel for commanders/leads who already use Discord as their main raid voice channel.

It is **not** a Discord replacement and **not** a general-purpose voice platform.

## Product model

- Discord stays open and carries the normal raid/squad communication.
- Commander Link provides a second, private, audio-only WebRTC mesh for up to 4 commanders.
- Desktop users can hold a configurable global hotkey or auxiliary mouse button to transmit while the game has focus.
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
                     signalling + presence + ICE metadata
                                   |
                                   v
                     WebRTC audio-only P2P mesh (max. 4 peers)
                     STUN for NAT traversal, TURN relay only as fallback
```

Cloudflare does **not** implement WebRTC signalling. The Durable Object only
protects room creation/join, expiration and the 4-peer admission limit. The
client renders against a provider-independent `VoiceTransport` interface;
`MeteredPeer` lives behind `MeteredRealtimeTransport`.

Every Commander Link room maps deterministically to a Realtime channel:
`commander-link/<room-id>`. Tokens are scoped to exactly that one channel.

### ICE configuration / TURN

Metered Realtime currently delivers **no** ICE configuration (verified:
`metadata.iceServers` is empty — `TURN configuration received: NO`). Because
`@metered-ca/realtime` creates every `RTCPeerConnection` internally, the client
injects an explicit **Open Relay fallback** at the SDK's
`rtcPeerConnectionFactory` — the single point every internal PC creation passes
through (new peers and reconnect PC swaps):

```
Metered welcome iceServers
    ↓
if non-empty → use them (unchanged)
otherwise    → Open Relay fallback (stun/turn/turns at staticauth.openrelay.metered.ca)
```

Production default is `iceTransportPolicy: "all"` (direct P2P preferred, TURN
only as fallback). A debug-only `?debug=webrtc&forceRelay=1` forces
`iceTransportPolicy: "relay"` for diagnostics. The Open Relay credentials are
Metered's public test credentials and are never shown verbatim in the
diagnostics report (only scheme/hostname/port).

### Using your own STUN/TURN servers

Replace the Open Relay fallback with your own STUN/TURN servers. Two ways:

1. **Public test credentials only** — edit `OPEN_RELAY_ICE_SERVERS` in
   `apps/web/src/ice-fallback.ts`. This list ships in the browser bundle, so
   only use it for credentials that are safe to expose.

2. **Private TURN servers (recommended)** — add `metadata.iceServers` to the
   minted Realtime JWT in `apps/worker/src/voice/metered.ts` (the
   `POST /v1/tokens` request body). Metered passes that metadata through in the
   welcome frame, and the client uses it automatically — the Open Relay
   fallback only applies when `iceServers` is absent. Credentials stay in
   Worker secrets (`wrangler secret put TURN_USERNAME` /
   `TURN_PASSWORD`), never in the client or the bundle:

```ts
// apps/worker/src/voice/metered.ts — token mint body
body: JSON.stringify({
  peerId,
  channels: [channel],
  permissions: ["publish", "subscribe", "presence", "send"],
  expiresInSec: this.config.tokenTtlSeconds,
  peerMetadata: { username: displayName },
  metadata: {
    iceServers: [
      { urls: "stun:stun.example.com:3478" },
      {
        urls: "turn:turn.example.com:3478?transport=udp",
        username: env.TURN_USERNAME,   // Wrangler secret
        credential: env.TURN_PASSWORD, // Wrangler secret
      },
    ],
  },
}),
```

The client prefers these servers and the Open Relay fallback is skipped.

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
- `apps/discord` — Cloudflare Worker handling Discord HTTP Interactions; authorizes the
  `/commander` slash command (signature + guild + Commander role) and triggers the existing
  room-creation API. Authorization entry point only, not a Gateway/voice bot. Which guilds may use
  `/commander` (and each guild's Commander role id) is configured versioned in
  `apps/discord/config/guilds.json`, bundled into the Worker.
- `packages/core` — shared types, room/API contracts and PTT state machine.
- `docs/` — product, architecture, security, networking and acceptance criteria.
- `AGENTS.md` — binding Codex implementation instructions.
- `TASKS.md` — ordered implementation plan. Codex should work top-to-bottom.

## Primary user journey

1. An authorized commander runs `/commander` in a configured Discord guild; Discord
   authorizes (guild + Commander role) and Commander Link initializes the room.
2. Discord publishes a browser invite like `https://commander-link.joinoops.win/r/<room-id>`
   and an Electron deep link `commanderlink://join/<room-id>` for the same room.
3. Other commanders open the same HTTPS link in browser, or the deep link to open
   the desktop app.
4. Electron receives a deep link such as `commanderlink://join/<room-id>`.
5. Each client asks the Worker for a scoped Realtime JWT.
6. `MeteredPeer` joins the room's channel, connects peers P2P and applies the
   Open Relay fallback ICE config when Metered supplies none.
7. Everyone starts muted.
8. Hold the configured desktop binding or the red browser button to transmit.
9. Release means mute immediately.

Rooms are **only** created through Discord; the public website is a join/voice
client and offers no "create room" flow. Invited participants join an existing
room with no Discord login or creator credentials.

## Status

This repository intentionally contains the architecture, contracts, scaffolding and Codex execution plan. `TASKS.md` defines what must be completed before release. Do not claim production-readiness until every MVP acceptance criterion passes.

## Running locally

Prerequisites: Node.js 22+, pnpm 10, and a Metered account with **Realtime Messaging** enabled (a `sk_id` + `sk_secret` key pair from Dashboard → Realtime Messaging → Keys). Cross-network audio uses the built-in Open Relay STUN/TURN fallback, so no separate TURN service is required for the MVP.

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

# 4. Optional: run the desktop shell (loads the web app, adds configurable global PTT + deep links)
pnpm dev:desktop
```

For `wrangler dev`, put secrets in `apps/worker/.dev.vars`:

```ini
METERED_REALTIME_KEY_ID=sk_id_...
METERED_REALTIME_SECRET=sk_secret_...
```

Open `http://localhost:5173`, paste an invite/room id to join. To create a room
for local testing, POST `POST /v1/rooms` to the local Worker with the configured
`ROOM_CREATE_SECRET` (as the Discord worker would), or use `pnpm dev:discord`.

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
| `ROOM_CREATE_SECRET` | Worker **secret** | Shared server-to-server secret authorizing room creation. Sent only by the Discord worker; enforced on `POST /v1/rooms`. Never exposed to clients. |

### Discord guild configuration

Which Discord servers may use `/commander`, and the Commander role id each requires,
is **not** an environment variable. It lives in `apps/discord/config/guilds.json`
(bundled into the Discord Worker):

```json
{
  "guilds": {
    "450409169795678229": {
      "name": "Commander Link Test",
      "commanderRoleId": "1249351808522915991",
      "enabled": true
    }
  }
}
```

Guild IDs and role IDs are not secrets and may be committed. Edit the file, deploy
the Discord worker (`pnpm deploy:discord`), then register the command for the new
guild (`pnpm register:discord:command`). See `apps/discord/README.md` → "Adding another
Discord server" for the full workflow and disabling a server (`"enabled": false`).

## Deployment

Run the deploy scripts from the repo root (each targets the right app directory):

- **Worker/API:** `pnpm deploy:worker` (or `cd apps/worker && wrangler deploy`). Set
  `METERED_REALTIME_KEY_ID`, `METERED_REALTIME_SECRET` and `ROOM_CREATE_SECRET` via
  `wrangler secret put`, and `APP_ORIGIN` in `wrangler.toml`. `ROOM_CREATE_SECRET`
  must match the value configured on the Discord worker so the Discord-authorized
  room-creation flow works.
- **Web:** `pnpm deploy:web` builds `apps/web` and deploys it as the static-assets
  Worker `commander-link` (served via the custom domain). A SPA fallback
  (`/* → /index.html`) is configured so `/r/<room-id>` resolves.
- **Desktop:** `pnpm --filter @commander-link/desktop build`, then package with your Electron
  packager. The app registers the `commanderlink://` protocol on Windows/Linux.
- **Discord:** `pnpm deploy:discord` (worker `commander-link-discord`) bundles the current
  `apps/discord/config/guilds.json` authorization config. To enable a **new** guild, add it there,
  deploy, then also run `pnpm register:discord:command` to install `/commander` on it. Set
  `ROOM_CREATE_SECRET` (and `DISCORD_BOT_TOKEN` for the register script) as Wrangler secrets.

## Deep links & the desktop app

- Primary invite is always HTTPS `/r/<room-id>` so a browser is a valid fallback.
- The desktop app registers `commanderlink://join/<room-id>` and routes second launches into the
  existing window (single instance).
- Global push-to-talk uses a native key/mouse hook (`uiohook-napi`) so the configured hold/release binding works while the
  game or another app has focus** — something `globalShortcut` cannot do (no key-up event).

## Desktop App

### Windows installer

Users install Commander Link for Windows from the **latest release**:

- Browser CTA: the hosted web app links to the latest GitHub Release
  (`https://github.com/baba-dorn/commander-link/releases/latest`).
- Installer artifact: `Commander-Link-Setup-<version>.exe` (NSIS, user-install, Start Menu +
  optional desktop shortcut, uninstaller, selectable install directory).
- The installer preserves the `commanderlink://` protocol registration.

> **SmartScreen / code signing:** the installer is currently **unsigned**. Windows SmartScreen may
> show an "Unknown publisher" / "More info" warning when you run it — select "More info" → "Run
> anyway". Public/production distribution should eventually use Authenticode code signing; this is
> intentionally not configured yet.

### Current web URL behaviour

The desktop shell always loads the hosted production web app
(`https://commander-link.joinoops.win`) because packaging runs with `NODE_ENV`
already set. During `pnpm dev` (or `pnpm dev:desktop`) it loads the local Vite dev server at
`http://localhost:5173`. Override for testing:

```powershell
# dev shell pointed at the deployed web app
$env:COMMANDER_LINK_WEB_URL="https://commander-link.joinoops.win"
pnpm dev:desktop
```

### Deep link handling

- Installed app registers `commanderlink://` during install (NSIS + electron-builder `protocols`) **and**
  at runtime via `setAsDefaultProtocolClient` in the packaged app (you don't rely on dev-mode only).
- A link like `commanderlink://join/<room-id>` launches the app if it is closed, and a running
  instance **receives the link and focuses itself** (single-instance lock + `second-instance` event).
- The renderer never touches the protocol; deep-link room IDs are routed through the narrow preload
  bridge. Electron keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

### Local build (from repo root)

Prerequisites: Node.js 22+, pnpm 10. (Electron + `uiohook-napi` build scripts are allowed via
`pnpm.onlyBuiltDependencies`.)

```powershell
# unpacked/debug app (for quick iteration): apps/desktop/release/win-unpacked/
pnpm dist:desktop:dir

# production Windows NSIS installer: apps/desktop/release/Commander-Link-Setup-<version>.exe
pnpm dist:desktop:win
```

Equivalent `--filter` forms: `pnpm --filter @commander-link/desktop dist:dir` /
`pnpm --filter @commander-link/desktop dist:win`.

### Packaging notes

- `apps/desktop` — electron-builder config lives in `electron-builder.config.cjs` (NSIS, appId
  `de.dorn.commanderlink`, `commanderlink` protocol, `apps/desktop/release` output).
- Only `dist/**` (compiled main + preload) and runtime dependencies are packaged; source files are
  excluded. The renderer is **not** bundled — the app loads the hosted web app.
- `uiohook-napi` ships prebuilt N-API binaries and is unpacked from asar (`asarUnpack`) so the
  native module and global PTT keep working in the packaged app.
- Icon: `apps/desktop/assets/icon.ico`. If absent, packaging falls back to the Electron default so a
  build is never blocked. Add a real icon before a public release.
- Keep runtime deps in the desktop `dependencies`; `@commander-link/core` is type-only there and
  lives in `devDependencies`.

### Release flow (GitHub Releases)

Releases are automated by `.github/workflows/release-desktop.yml`:

1. Update the desktop version (`apps/desktop/package.json`), commit and push.
2. Tag the release: `git tag v0.1.0`
3. Push the tag: `git push origin v0.1.0`
4. The workflow typechecks, tests, builds, packages the Windows installer and creates/updates the
   GitHub Release tagged `v<version>` (title `Commander Link v<version>`) with the `.exe` attached.

Artifacts: `apps/desktop/release/` locally; the attached installer on the GitHub Release.

## Steam Deck / Linux notes

Global key capture under Wayland is restricted. On X11 (Steam Deck Desktop Mode / gaming mode via
`uiohook`) keyboard and auxiliary mouse capture generally works; under strict Wayland compositors it may not. The browser
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
