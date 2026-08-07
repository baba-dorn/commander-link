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
                         +--> Cloudflare Worker / RoomGate DO --> scoped Metered JWT
Electron + React client -/                                   
                                   |
                                   v
                       Metered Realtime Messaging
                       signalling + presence + TURN metadata
                                   |
                                   v
                         WebRTC audio-only P2P mesh
                         Open Relay TURN only as fallback
```

Cloudflare does **not** implement WebRTC signalling. The Durable Object only protects room creation/join, expiration and the 4-peer admission limit.

## Security invariants

1. Metered secret credentials never ship to clients.
2. Clients receive short-lived, room-scoped JWTs only.
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
5. Each client asks the Worker for a scoped join token.
6. Metered connects peers and injects TURN configuration.
7. Everyone starts muted.
8. Hold F8 (desktop) or hold the red button (browser) to transmit.
9. Release means mute immediately.

## Status

This repository intentionally contains the architecture, contracts, scaffolding and Codex execution plan. `TASKS.md` defines what must be completed before release. Do not claim production-readiness until every MVP acceptance criterion passes.
