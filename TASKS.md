# TASKS — implement top to bottom

## P0 — freeze contracts

- [x] Verify current Metered client API — adopted `@metered-ca/realtime` (MeteredPeer) per the official Realtime docs; documented in `docs/vendor-notes.md`.
- [x] Verify current Cloudflare Workers + SQLite Durable Objects configuration syntax (builds clean via `wrangler deploy --dry-run`).
- [x] Finalize shared Zod/TypeScript contracts for room create, join, leave, token response and participant/room state (`packages/core`).
- [x] Add threat-model tests/fixtures before implementing secrets or tokens (PTT fail-closed + admission-capacity unit tests).

Acceptance: contracts compile and docs match current vendor APIs. ✅

## P0.5 — Realtime transport migration (Metered.Meeting → MeteredPeer)

- [x] Remove the Metered Video SDK: `Metered.Meeting()`, `/api/v1/room` provisioning, Video room tokens, `roomURL`.
- [x] Add `@metered-ca/realtime` to the shared renderer (`apps/web`); drop the Video SDK CDN script.
- [x] Deterministic room → channel mapping: `commander-link/<room-id>` (`channelForRoom` in `packages/core`).
- [x] Worker mints channel-scoped Realtime JWTs via `rms.metered.ca/v1/tokens` (`sk_id`/`sk_secret` Bearer) — no Video Room is created on room creation.
- [x] `MeteredRealtimeTransport` behind the provider-independent `VoiceTransport` interface.
- [x] Mic acquired once (`getUserMedia({ audio: true, video: false })`), kept alive; PTT toggles `track.enabled` (no renegotiation per key press).
- [x] Remote audio per-peer `<audio>` elements + per-peer volume; presence-driven roster (`peer-joined`/`peer-left`).
- [x] Reconnect states `connecting/connected/reconnecting/disconnected`; reconnect returns muted (fail-closed).
- [x] Dev-only diagnostics: room id, channel, peer count, per-peer state, ICE state, selected candidate type (`host`/`srflx`/`relay`) — never credentials.
- [x] Tests: token response contract, channel naming, participant mapping, cleanup on peer-left, no Video room provisioning.

Acceptance: no `Metered.Meeting()` or Video Room provisioning remains; browser and Electron share the same transport. ✅

## P1 — shared PTT core

- [x] Implement `PttController` as a small fail-closed state machine.
- [x] States: `muted`, `transmitting`, `blocked`, `disconnected`.
- [x] Events: press, release, blur, hidden, disconnect, reconnect, error.
- [x] Reconnect must enter `muted`, never `transmitting`.
- [x] Unit test stuck-key/focus-loss sequences.

Acceptance: no tested event sequence can leave transmission enabled after a release/error/focus loss. ✅

## P2 — Cloudflare Room Gate

- [x] Implement `POST /v1/rooms` with cryptographically random unguessable room IDs (32 hex chars).
- [x] Implement `GET /v1/rooms/:id` public safe room metadata.
- [x] Implement `POST /v1/rooms/:id/join`.
- [x] Implement `POST /v1/rooms/:id/leave` best-effort release (+ `/heartbeat` for lease keep-alive).
- [x] Use one SQLite-backed Durable Object per room for serialized admission state.
- [x] Enforce configured TTL and max peers (default 4), with idle-lease reclamation.
- [x] Mint channel-scoped Metered Realtime JWT server-side (`rms.metered.ca/v1/tokens`), never a publishable/secret key to clients.
- [x] Never return Metered secret credentials.
- [~] Coarse request-size guard + CORS allowlist in place; explicit TODO for edge rate limiting.
- [x] Implement `/health` with no secrets.
- [x] Test fifth-join rejection (admission-logic unit test; DO serializes concurrency).

Acceptance: 4 simultaneous admissions succeed, 5th fails; expired/nonexistent room cannot mint token. ✅

## P3 — Metered Realtime / WebRTC client

- [x] Create a single shared connection service (`apps/web/src/connection.ts`) behind the `VoiceTransport` interface (`apps/web/src/transport.ts`).
- [x] Join via `MeteredPeer` with a Worker-issued channel-scoped JWT (`tokenProvider`), never a publishable/master key.
- [x] Acquire microphone audio only (`getUserMedia({ audio: true, video: false })`); add the stream before `join()`.
- [x] Start local audio once and keep the connection alive; PTT toggles `track.enabled` for mute/unmute.
- [x] Attach each remote audio stream to a dedicated per-peer audio element.
- [x] Surface participant joined/left (presence), connection/reconnect state and voice-level activity (RMS analyser).
- [x] Ensure leave closes the `MeteredPeer`, stops local tracks and removes per-peer audio.

Acceptance: 4 local browser instances can join and exchange PTT audio. (manual verification)

## P4 — browser UX

- [x] Room creation page with copyable HTTPS invite.
- [x] Join page `/r/:roomId` with display-name-only local identity; no account.
- [x] Explicit microphone permission step (mic acquired on join).
- [x] Large red hold-to-talk target suitable for second monitor/touch.
- [x] Pointer capture; mute on pointerup/cancel/leave, window blur, visibility hidden, pagehide, disconnect.
- [x] Participant list, own mute/TX state, connection status.
- [x] Per-peer output volume control.
- [x] Button `In Desktop-App öffnen` invoking `commanderlink://join/<roomId>` with graceful fallback.
- [x] Room code / invite-link entry fallback on the home page (shared `extractRoomId` parsing).

Acceptance: a browser-only user can complete the entire flow without installing software. ✅

## P5 — Electron desktop shell

- [x] Load the same React app/renderer; no forked product logic.
- [x] Register `commanderlink://` protocol on Windows and Linux.
- [x] Parse and validate room IDs from deep links.
- [x] Enforce single-instance behavior and route second deep-link launches into the existing window.
- [x] Secure preload bridge exposing only PTT/deep-link capabilities (contextIsolation, no Node in renderer).
- [x] True global hold/release PTT for F8 via `uiohook-napi` while another app has focus.
- [x] Document Linux/Steam Deck X11 vs Wayland key-capture limitations and browser fallback (README).
- [x] Desktop PTT events feed the exact shared `PttController` used by the browser button.
- [x] App starts muted; reconnect returns muted (fail-closed state machine).

Acceptance: Windows desktop can join from HTTPS/deep link and F8 hold/release controls only Commander Link, independent of Discord. (manual verification)

## P6 — networking + resilience

- [x] Test direct P2P path (verified 2026-08-07: 4-peer mesh, all `host` candidates, all connected).
- [ ] Force/test TURN relay path using Metered/Open Relay.
- [x] Add a safe diagnostics panel: connected peers, ICE connection state, candidate type (`host/srflx/relay`) where available; never show credentials (`?diag=1` / `vite dev`).
- [ ] Test Windows↔Windows, Windows↔Linux/Steam Deck and browser↔desktop.
- [ ] Test NAT/firewall scenarios where practical.
- [ ] Test brief Wi-Fi/network interruption and verify reconnect returns muted.

Acceptance: relay fallback is observable and reconnection never causes accidental TX.

## P7 — CI/release/docs

- [x] GitHub Actions: install, typecheck, unit tests, builds (`.github/workflows/ci.yml`).
- [x] Build web static assets (`vite build`, SPA `_redirects` included).
- [ ] Build Windows installer; build Linux AppImage or appropriate package.
- [x] Document Cloudflare deployment and required secrets (README).
- [x] Document Metered app name + secret key usage (README + docs/vendor-notes.md).
- [x] Document deep-link registration/troubleshooting (README).
- [x] Document browser fallback and Steam Deck limitations (README).
- [x] Add privacy note: no recording/transcription in MVP (README).
- [x] Manual test matrix retained in docs/networking.md.

Acceptance: a fresh developer can deploy from README without committing secrets.

## Explicitly out of scope for MVP

- Discord bot/activity integration
- replacing Discord main voice
- video or screen sharing
- recording/transcription
- persistent user accounts
- permanent rooms
- more than 4 peers
- SFU/media server
- custom SDP/ICE signalling server
- automatic Discord audio ducking
- mobile native apps
