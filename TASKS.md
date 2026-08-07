# TASKS — implement top to bottom

## P0 — freeze contracts

- [ ] Verify current `@metered-ca/realtime` package API against official docs and pin a tested version.
- [ ] Verify current Cloudflare Workers + SQLite Durable Objects configuration syntax.
- [ ] Finalize shared Zod/TypeScript contracts for room create, join, leave, token response and participant state.
- [ ] Add threat-model tests/fixtures before implementing secrets or tokens.

Acceptance: contracts compile and docs match current vendor APIs.

## P1 — shared PTT core

- [ ] Implement `PttController` as a small fail-closed state machine.
- [ ] States: `muted`, `transmitting`, `blocked`, `disconnected`.
- [ ] Events: press, release, blur, hidden, disconnect, reconnect, error.
- [ ] Reconnect must enter `muted`, never `transmitting`.
- [ ] Unit test stuck-key/focus-loss sequences.

Acceptance: no tested event sequence can leave transmission enabled after a release/error/focus loss.

## P2 — Cloudflare Room Gate

- [ ] Implement `POST /v1/rooms` with cryptographically random unguessable room IDs.
- [ ] Implement `GET /v1/rooms/:id` public safe room metadata.
- [ ] Implement `POST /v1/rooms/:id/join`.
- [ ] Implement `POST /v1/rooms/:id/leave` best-effort release.
- [ ] Use one SQLite-backed Durable Object per room for serialized admission state.
- [ ] Enforce configured TTL and max peers (default 4).
- [ ] Mint Metered JWT using server-side secret key pair, channel scoped to this room, short expiry.
- [ ] Never return Metered secret credentials.
- [ ] Add coarse create/join abuse controls and explicit TODO/config surface for stronger Cloudflare rate limiting.
- [ ] Implement `/health` with no secrets.
- [ ] Test concurrent fifth-join rejection.

Acceptance: 4 simultaneous admissions succeed, 5th fails; expired/nonexistent room cannot mint token.

## P3 — Metered/WebRTC client

- [ ] Create a single shared connection service in `packages/core` or web shared code.
- [ ] Join with Worker-issued JWT, not publishable/master key.
- [ ] Acquire microphone audio only.
- [ ] Add local stream once and keep connection alive while muting/unmuting track.
- [ ] Attach each remote audio stream to a dedicated audio element.
- [ ] Surface participant joined/left, connection/reconnect state and relay diagnostic.
- [ ] Ensure leave tears down tracks, peers and WebSocket.

Acceptance: 4 local browser instances can join and exchange PTT audio.

## P4 — browser UX

- [ ] Room creation page with copyable HTTPS invite.
- [ ] Join page `/r/:roomId` with display-name-only local identity; no account.
- [ ] Explicit microphone permission step.
- [ ] Large red hold-to-talk target suitable for second monitor/touch.
- [ ] Use pointer capture where appropriate; mute on pointerup/cancel/leave and all fail-closed browser events.
- [ ] Participant list, own mute/TX state, connection status.
- [ ] Per-peer output volume control.
- [ ] Button `In Desktop-App öffnen` invoking `commanderlink://join/<roomId>` with graceful fallback.
- [ ] Optional room code entry fallback.

Acceptance: a browser-only user can complete the entire flow without installing software.

## P5 — Electron desktop shell

- [ ] Package the same React app/renderer; avoid forked product logic.
- [ ] Register `commanderlink://` protocol on Windows and Linux.
- [ ] Parse and validate room IDs from deep links.
- [ ] Enforce single-instance behavior and route second deep-link launches into the existing window.
- [ ] Secure preload bridge exposing only PTT/deep-link/window capabilities.
- [ ] Implement true global hold/release PTT for Windows F8 while Guild Wars 2/another application has focus.
- [ ] Evaluate Linux/Steam Deck global key capture under X11 and Wayland; document limitations and safe fallback.
- [ ] Desktop PTT events feed the exact shared `PttController` used by browser button.
- [ ] App starts muted; crash/restart/reconnect starts muted.

Acceptance: Windows desktop can join from HTTPS/deep link and F8 hold/release controls only Commander Link, independent of Discord.

## P6 — networking + resilience

- [ ] Test direct P2P path.
- [ ] Force/test TURN relay path using Metered/Open Relay.
- [ ] Add a safe diagnostics panel: connected peers, ICE connection state, candidate type (`host/srflx/relay`) where available; never show credentials.
- [ ] Test Windows↔Windows, Windows↔Linux/Steam Deck and browser↔desktop.
- [ ] Test NAT/firewall scenarios where practical.
- [ ] Test brief Wi-Fi/network interruption and verify reconnect returns muted.

Acceptance: relay fallback is observable and reconnection never causes accidental TX.

## P7 — CI/release/docs

- [ ] GitHub Actions: install, lint, typecheck, unit tests, builds.
- [ ] Build web static assets.
- [ ] Build Windows installer; build Linux AppImage or appropriate package.
- [ ] Document Cloudflare deployment and required secrets.
- [ ] Document Metered key creation with least privileges.
- [ ] Document deep-link registration/troubleshooting.
- [ ] Document browser fallback and Steam Deck limitations.
- [ ] Add privacy note: no recording/transcription in MVP.
- [ ] Add release checklist/manual test matrix.

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
