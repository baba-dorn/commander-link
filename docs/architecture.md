# Architecture

## Components

### React web/renderer
Owns room UI, microphone permission, participant rendering, browser PTT and audio playback.

### Electron shell
Owns OS integration only: global PTT, deep links, single-instance routing, packaging. Product/WebRTC logic stays shared.

### Cloudflare Worker
Public API and secret boundary. Validates room operations and requests scoped Metered JWTs.

### RoomGate Durable Object
One object per room. Serializes admission, tracks temporary leases, enforces max 4, persists room expiry. It is not a signalling server.

### Metered Realtime + `@metered-ca/realtime`
Managed signalling, presence/peer discovery, WebRTC negotiation, reconnect and TURN metadata/injection according to current Metered SDK behavior.

### WebRTC mesh
For N<=4, every participant sends one audio track to other peers. No SFU in MVP.

## Suggested room channel

`commander-link/room/<opaque-room-id>`

Tokens must authorize only the exact room channel needed by that peer.

## Admission vs presence

RoomGate admission is a security/capacity lease, not authoritative media presence. Metered presence is used for live peer UI. A short admission lease/heartbeat strategy should prevent abandoned leases from permanently filling rooms. Codex should choose the simplest robust strategy and test concurrent admission.

## Deep links

Primary invite:
`https://<app-origin>/r/<room-id>`

Desktop protocol:
`commanderlink://join/<room-id>`

The HTTPS route always works as browser fallback.
