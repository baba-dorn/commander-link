# Vendor notes (verified 2026-08-07)

These notes are intentionally dated. Codex must re-check official docs before relying on details that may have changed.

## Metered

Official Metered Open Relay pages currently describe:
- free Realtime Messaging signalling with channels, presence and direct messaging;
- JWT or publishable-key authentication;
- REST token minting using a server-side `sk_id` + `sk_secret` pair;
- token scope fields including channels, permissions and expiry;
- TURN/ICE metadata carried in token/welcome flow;
- `@metered-ca/realtime` as the open-source JS WebRTC helper;
- Open Relay free TURN allowance advertised as 20 GB/month.

For production, this repo requires Worker-minted scoped JWTs rather than a publishable key embedded in clients.

## Implemented Metered integration (verified against a working reference app)

A working reference implementation (`F:\code\metered-demo`, plus the bundled Metered
`llms-*.txt` docs) validated a slightly different but officially supported flow, which this
repo adopts:

- **Client SDK:** the **Metered Video SDK** loaded from the CDN
  (`//cdn.metered.ca/sdk/video/1.4.6/sdk.min.js`, global `Metered.Meeting()`), configured for
  audio-only (`receiveVideoStreamType: "none"`, `startAudio()` + `muteLocalAudio()`), rather than
  the bundled `@metered-ca/realtime` package. The Video SDK gives full audio-only WebRTC control
  (start/mute/unmute) required for push-to-talk and avoids camera prompts.
- **Server token minting:** `POST https://<appName>.metered.live/api/v1/token?secretKey=...`
  with `{ roomName, name, isAdmin: false }` returns a room-scoped access token. The `secretKey`
  lives only in the Cloudflare Worker (Wrangler secret `METERED_SECRET_KEY`) and is never
  returned to a client, logged, or bundled.
- **Room provisioning:** `POST /api/v1/room` with `audioOnlyRoom: true`, `privacy: "private"`,
  `maxParticipants` and `ejectAfterElapsedTimeInSec` set to the configured limits.
- **TURN:** Metered Open Relay ICE config (`global.relay.metered.ca`, ports 80/443, UDP→TCP→TLS)
  is delivered by Metered as part of the authenticated join flow; direct P2P remains preferred.

This satisfies every security invariant (server-only secret, room-scoped short-lived token,
audio-only official client). AGENTS.md explicitly permits adapting when the SDK differs from the
docs, provided secret isolation and room scoping are preserved. The Worker/DO boundary is
unchanged: Cloudflare only mints tokens and enforces admission/capacity/expiry.

## Cloudflare

Official Cloudflare documentation currently states Durable Objects are available on Workers Free, with new Free-plan Durable Objects using SQLite-backed storage. This project uses a DO only for room/admission coordination, not media or signalling.
