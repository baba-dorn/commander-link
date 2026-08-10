# Architecture

## Components

### React web/renderer
Owns room UI, microphone permission, participant rendering, browser PTT and audio playback. It talks only to the provider-independent `VoiceTransport` interface — never to MeteredPeer directly.

### Electron shell
Owns OS integration only: global PTT, deep links, single-instance routing, packaging. Product/WebRTC logic stays shared.

### Cloudflare Worker
Public API and secret boundary. Owns room creation, admission and cleanup routing. It depends only on the `VoiceBackend` interface — never on a concrete media provider.

### RoomGate Durable Object
One object per room and **Commander Link's source of truth**. It owns room metadata, admission (serialized so max 4 cannot be raced), TTL, heartbeats and the full lifecycle/cleanup. It is not a signalling server and never proxies media.

### VoiceBackend (provider abstraction)
A small interface the Worker talks to for transport only. With Metered Realtime Messaging, a room is just a channel name — there is nothing to provision or delete — so the interface is a single token mint:

```ts
interface VoiceBackend {
  createAccessToken(roomId, peerId, displayName): Promise<{ token; channel; expiresAt }>;
}
```

`MeteredRealtimeVoiceBackend` is the only implementation that knows Metered's token-minting endpoint and the secret key pair. Swapping providers (LiveKit, coturn + custom signalling, mediasoup, …) means replacing this class only — no Worker or DO changes.

### MeteredRealtimeTransport (client transport)
The web/Electron renderer side of the boundary. Wraps `@metered-ca/realtime`'s `MeteredPeer`: signalling, presence, SDP/ICE coordination, reconnect and auto-injected TURN. Exposes only the `VoiceTransport` interface to the UI:

```ts
interface VoiceTransport {
  connect(session: VoiceSession, displayName: string): Promise<void>;
  disconnect(): Promise<void>;
  transmit(): Promise<boolean>;
  mute(): Promise<void>;
  setVolume(peerId: string, volume: number): void;
  getDiagnostics(): Promise<TransportDiagnostics>; // dev-only, never credentials
}
```

### WebRTC mesh
For N<=4, every participant sends one audio track to every other peer via `MeteredPeer`'s automatic mesh (max. 3 RTCPeerConnections per peer). No SFU in MVP.

## Ownership

```text
Commander Link  (the product — provider independent)
├── RoomGate (Durable Object)
│   ├── Room lifecycle (create → occupied → empty grace → cleanup)
│   ├── Participant management (admission, capacity, heartbeat/TTL)
│   └── Scheduled cleanup (DO alarm safety net)
└── VoiceBackend  (transport only)
        └── MeteredRealtimeVoiceBackend  (Realtime JWT minting)
```

Commander Link owns: rooms, invitations, participants, admission, TTL, heartbeat, cleanup and lifecycle.
The Voice Backend owns: token minting and the transport contract. Metered Realtime owns: signalling, presence, WebRTC coordination, reconnect and TURN credential delivery.

## Room lifecycle (no transport provisioning)

0. **Initiation (Discord only)** — rooms are created **exclusively through the
   authorized Discord integration**. A `/commander` user must belong to a
   configured, enabled guild with the per-guild Commander role id. The Discord
   worker then calls `POST /v1/rooms` with the shared `ROOM_CREATE_SECRET`;
   arbitrary public clients are rejected with `401`. There is deliberately no
   public "create room" path and no separate creator account/key.
1. **Create** — `POST /v1/rooms` stores the Commander Link room in a Durable Object. **No transport provider is provisioned** — Metered Realtime channels exist by name and cost nothing while idle, so rooms nobody enters cost no infrastructure.
2. **First join** — the first admitted participant's token is minted server-side; the channel name is derived deterministically from the room id.
3. **Occupied** — participants send heartbeats; missed heartbeats time out a lease (crash / sleep / network loss recovery).
4. **Empty grace** — when the last participant leaves, the room is kept for a short grace period (default 5 min) so a quick reconnect does not lose the room.
5. **Cleanup** — a periodic DO alarm is the safety net: it prunes dead heartbeats and, once a room is empty past the grace period or has expired (TTL), deletes the room. There is no provider session to tear down. Cleanup never relies solely on `leave()`.

## Room → Realtime channel mapping

Every Commander Link room maps deterministically to exactly one Metered Realtime channel:

```text
Room:    bb63eaf988d4415e8f23413c4eeb566
Channel: commander-link/bb63eaf988d4415e8f23413c4eeb566
```

The channel name is minted by `channelForRoom()` in `packages/core` (single source of truth). The join JWT authorizes exactly this one channel, so tokens cannot be used to join any other room.

## Authentication

```text
Browser / Electron
       |
       | POST /v1/rooms/:id/join  (admission validated by RoomGate)
       v
Cloudflare Worker
       | mints short-lived Metered Realtime JWT via rms.metered.ca/v1/tokens
       v
Client receives { roomId, peerId, realtimeToken, channel, admissionId, expiresAt }
       |
       v
MeteredPeer tokenProvider()  (re-invoked on every reconnect)
```

**Creation vs participation.** Creating a room requires Discord authorization
(configured guild + Commander role); **joining** an existing room does not — any
invited participant with the HTTPS invite or `commanderlink://` deep link can
join by display name and microphone, with no Discord login, creator credentials
or guild membership required. The change removes only public *creation*, never
normal participation.

The JWT carries:
- `sub` — the Commander Link peerId (stable across reconnects),
- `channels` — exactly `commander-link/<room-id>`,
- `permissions` — `publish`, `subscribe`, `presence`, `send`,
- `peerMetadata.username` — display name, surfaced on presence,
- short expiry (`TOKEN_TTL_SECONDS`, default 1h).

Metered TURN credentials are auto-injected by the Realtime service into the welcome message when the key's "Auto-inject TURN" toggle is on (default). When Metered delivers no `metadata.iceServers` (currently the case — verified `TURN configuration received: NO`), the client applies an explicit Open Relay fallback (`stun`/`turn`/`turns` at `staticauth.openrelay.metered.ca`) via the SDK's `rtcPeerConnectionFactory`, so every RTCPeerConnection the SDK creates internally has working STUN/TURN. The Open Relay credentials are the public, published test credentials and are never surfaced verbatim in diagnostics (only scheme/hostname/port + "credentials present"). A coturn or other provider remains swappable behind the same factory integration point.

## Admission vs presence

RoomGate admission is a security/capacity lease, not authoritative media presence. Metered Realtime presence (`peer-joined` / `peer-left`) drives the live participant UI. The RoomGate 4-peer limit is the hard authority; Metered presence is never used to enforce capacity.

## Deep links

Commander Link rooms are **not** created from the public website. Room creation
is initiated exclusively through the Discord integration, and Discord provides
**two** launch paths for the same room — a browser URL and an Electron deep link:

```
Browser:      https://<app-origin>/r/<room-id>
Desktop app:  commanderlink://join/<room-id>
```

Both carry the same room id (and any equivalent invitation/access data) and
resolve to the same Commander Link room. The HTTPS route always works as browser
fallback; the `commanderlink://` route opens the installed desktop app. The
Electron shell validates deep-link room ids and routes them into the same shared
join flow used by the browser.
