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
  "Auto-inject TURN" toggle is on (default). Open Relay / coturn remain a
  separately swappable TURN provider behind the transport boundary; nothing is
  hardcoded in the client.
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
