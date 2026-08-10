# Networking

## Transport stack

Commander Link uses `@metered-ca/realtime`'s `MeteredPeer` for an audio-only
peer-to-peer WebRTC mesh:

```text
Commander Link RoomGate
    ↓
Metered Realtime signalling / presence  (wss://rms.metered.ca)
    ↓
MeteredPeer (perfect negotiation, ICE trickle, reconnect ladder)
    ↓
WebRTC audio mesh — up to 4 peers, one RTCPeerConnection per peer
    ↓
TURN relay only when ICE requires it
```

- **Direct P2P is preferred** and is what the mesh uses whenever host or
  server-reflexive (`srflx`) candidates connect.
- **TURN is fallback only.** Metered Realtime auto-injects Metered TURN
  credentials via the authenticated welcome message when the Realtime key's
  "Auto-inject TURN" toggle is on (default). Metered currently delivers no
  `metadata.iceServers` (verified `TURN configuration received: NO`), so the
  client applies an explicit Open Relay fallback
  (`stun`/`turn`/`turns` at `staticauth.openrelay.metered.ca`) through the
  SDK's `rtcPeerConnectionFactory` — the single point every internal
  RTCPeerConnection is created through. Metered-provided servers, when present,
  win over the fallback. A coturn or other provider remains swappable behind
  that same integration point.
- No SFU, no media server, no video, no screen sharing.

## Required tests

- direct ICE connection (`host` / `srflx`)
- relayed connection (`relay`) — verify separately, e.g. behind a symmetric NAT
- 2, 3 and 4 peers
- Windows desktop ↔ Windows desktop
- Windows desktop ↔ browser
- Windows ↔ Linux/Steam Deck where available
- reconnect after brief network loss (must return muted)

## Diagnostics

The development-only diagnostics panel (`?diag=1` in the URL, or always in
`vite dev`) shows safe runtime facts:

- Commander Link room id
- Realtime channel name
- local peer id and SDK state
- remote peer count
- per-peer connection state
- per-peer `RTCPeerConnection.iceConnectionState`
- selected candidate type (`host` | `srflx` | `relay`) where the stats report
  exposes it

Never display token contents, TURN username/password or Worker secrets. The
candidate type column is how the project distinguishes direct P2P from TURN
relay in practice.
