# Architecture

## Components

### React web/renderer
Owns room UI, microphone permission, participant rendering, browser PTT and audio playback.

### Electron shell
Owns OS integration only: global PTT, deep links, single-instance routing, packaging. Product/WebRTC logic stays shared.

### Cloudflare Worker
Public API and secret boundary. Owns room creation, admission and cleanup routing. It depends only on the `VoiceBackend` interface — never on a concrete media provider.

### RoomGate Durable Object
One object per room and **Commander Link's source of truth**. It owns room metadata, admission (serialized so max 4 cannot be raced), TTL, heartbeats, lazy provisioning state and the full lifecycle/cleanup. It is not a signalling server and never proxies media.

### VoiceBackend (provider abstraction)
A small interface the Worker and Durable Object talk to for transport only:

```ts
interface VoiceBackend {
  createSession(roomId): Promise<void>;                       // provision transport (idempotent)
  createAccessToken(roomId, displayName): Promise<{ token; roomUrl }>;
  deleteSession(roomId): Promise<void>;                       // best-effort teardown
}
```

`MeteredVoiceBackend` is the only implementation that knows Metered REST endpoints, room configuration and the secret key. Swapping providers (LiveKit, coturn + custom signalling, mediasoup, …) means replacing this class only — no Worker or DO changes.

### WebRTC mesh
For N<=4, every participant sends one audio track to other peers. No SFU in MVP.

## Ownership

```text
Commander Link  (the product — provider independent)
├── RoomGate (Durable Object)
│   ├── Room lifecycle (create → occupied → empty grace → cleanup)
│   ├── Participant management (admission, capacity, heartbeat/TTL)
│   └── Scheduled cleanup (DO alarm safety net)
└── VoiceBackend  (transport only)
        └── MeteredVoiceBackend  (token creation, WebRTC, TURN, session)
```

Commander Link owns: rooms, invitations, participants, admission, TTL, heartbeat, cleanup and lifecycle.
The Voice Backend owns: token generation, WebRTC session, TURN and media transport.

## Room lifecycle (lazy provisioning + cleanup)

1. **Create** — `POST /v1/rooms` stores the Commander room in a Durable Object. **No backend session is provisioned yet**, so rooms nobody enters cost no infrastructure.
2. **First join** — the first admitted participant triggers `VoiceBackend.createSession()` (idempotent); the DO marks the room provisioned. Subsequent joins reuse it.
3. **Occupied** — participants send heartbeats; missed heartbeats time out a lease (crash / sleep / network loss recovery).
4. **Empty grace** — when the last participant leaves, the room is kept for a short grace period (default 5 min) so a reconnect does not lose the session.
5. **Cleanup** — a periodic DO alarm is the safety net: it prunes dead heartbeats and, once a room is empty past the grace period or has expired (TTL), calls `VoiceBackend.deleteSession()` and deletes the room. Cleanup never relies solely on `leave()`.


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
