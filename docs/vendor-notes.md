# Vendor notes (verified 2026-08-07)

These notes are intentionally dated. Codex must re-check official docs before relying on details that may have changed.

## Metered Realtime Messaging (current production path)

Commander Link's voice transport is **`@metered-ca/realtime`** (v1.2.0) using
**`MeteredPeer`**. Verified against the official docs:

- `https://www.metered.ca/docs/realtime-messaging/sdk-javascript/`
- `https://www.metered.ca/docs/realtime-messaging/sdk-javascript/api-reference/metered-peer`
- `https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/authentication`
- `https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/webrtc-video-call`
- `https://www.metered.ca/docs/realtime-messaging/rest-api/tokens`

### What Metered owns

- Realtime signalling (`wss://rms.metered.ca`), channel presence (`peer-joined`/`peer-left`),
- SDP/ICE exchange through perfect negotiation,
- reconnect handling (exponential backoff, `state-change`, `tokenProvider` refresh on every reconnect),
- automatic TURN credential injection into the welcome message (key toggle "Auto-inject TURN", default on).

### What Commander Link owns

Rooms, invitations, admission, max-4 capacity, identity (peerId/displayName), room TTL, heartbeat, PTT,
UI, voice-level analysis, diagnostics. Room creation provisions **no** Metered resource.

### Token minting (server-side only)

`MeteredRealtimeVoiceBackend` calls:

```
POST https://rms.metered.ca/v1/tokens
Authorization: Bearer <sk_id>:<sk_secret>
{
  "peerId": "<commander-link peer id>",
  "channels": ["commander-link/<room-id>"],
  "permissions": ["publish", "subscribe", "presence", "send"],
  "expiresInSec": <TOKEN_TTL_SECONDS>,
  "peerMetadata": { "username": "<display name>" }
}
```

Response `{ token, expiresAt }` is wrapped into the join response
(`realtimeToken`, `channel`, `expiresAt`). The JWT is scoped to exactly one
channel and a short expiry. TURN credentials are **not** embedded in the JWT —
the Realtime service auto-injects them (a JWT `metadata.iceServers` would
override auto-injection if a custom TURN provider is ever needed; that override
stays server-side).

### Key pair

- `sk_id_…` + `sk_secret_…` from Dashboard → Realtime Messaging → Keys.
- Both are **secrets**: `wrangler secret put METERED_REALTIME_KEY_ID` /
  `METERED_REALTIME_SECRET`, and `apps/worker/.dev.vars` for local dev.
- Never in `wrangler.toml [vars]`, browser bundles, Electron preload/renderer,
  logs, tests or committed files.

### Client-side PTT

- One microphone `MediaStream` acquired on join (`getUserMedia({ audio: true, video: false })`) and kept alive.
- PTT toggles `track.enabled` — silence without renegotiating the PeerConnection, per the official
  "Toggle audio" guidance. Every failure path fails closed to `enabled = false`.
- `peer.addStream()` is called before `join()` so the audio track rides in the first SDP offer.

### Reconnect

`MeteredPeer.state-change` drives the UI (`connecting`/`connected`/`reconnecting`/`disconnected`).
On any `reconnecting` transition the transport mutes the local track and the shared
`PttController` is reset to muted (`reconnect` event → `muted`). After reconnect the user must
press F8 / the button again. Token refresh on reconnect re-runs the Worker join endpoint, which
reuses the existing admission lease (idempotent) and mints a fresh JWT.

## Cloudflare

Official Cloudflare documentation currently states Durable Objects are available on Workers Free, with new Free-plan Durable Objects using SQLite-backed storage. This project uses a DO only for room/admission coordination, not media or signalling.

## History

**2026-08-07 (initial):** The first integration used the Metered Video SDK
(`Metered.Meeting()` + `/api/v1/room` provisioning) because a working reference
app validated that flow. That path was retired with the Realtime migration:
no Video Room is created or deleted, no `Metered.Meeting()` remains, and
`Metered.Meeting` concepts (`roomURL`, Video room tokens) are gone from the
contracts. Room creation is now fully local to the Worker/DO.
