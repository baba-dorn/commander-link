# Debugging WebRTC / PTT drops

This document describes the diagnostic instrumentation added to identify what
changes when Push-To-Talk starts transmitting audio. Nothing in this document
changes PTT, negotiation, reconnect, heartbeat or room-lifecycle behaviour — it
only makes the failure observable.

## How to enable the diagnostics

| Client | How |
|---|---|
| Browser (dev) | enabled automatically (`vite dev`) |
| Browser (prod build) | append `?debug=webrtc` to the invite URL |
| Electron (dev) | enabled automatically |
| Electron (packaged Windows test) | launch the installed app with `COMMANDER_LINK_DEBUG_LOGS=1`; renderer `[webrtc]` lines are written to `commander-link-debug.log` next to the executable |

In debug mode an additional `Diagnostik (Entwicklung)` panel is shown in the
room UI. It shows per-participant connection state, ICE state, selected
candidate path, RTT and audio byte/packet counters, plus a **Copy diagnostics**
button that produces a plain-text report for bug reports.

## What is logged

Console lines are prefixed `[webrtc]` and include:

- per-peer `connectionState`, `iceConnectionState`, `iceGatheringState`,
  `signalingState` transitions (logged only on change)
- `negotiationneeded`, `signalingstatechange`, and SDP-flow labels
  (`offer created`, `answer created`, `local description set`, `remote
  description set`) — never full SDP
- the local microphone track lifecycle (`TRACK_CREATED`, `TRACK_ENABLED`,
  `TRACK_DISABLED`, `TRACK_MUTE`, `TRACK_UNMUTE`, `TRACK_ENDED`,
  `TRACK_STOPPED`)
- PTT snapshots (`PTT_DOWN`, `PTT_UP`) including the local track state and every
  peer's connection/ICE/signaling state
- low-frequency stats snapshots (`WEBRTC_CONNECTED_SNAPSHOT`, `PTT_START_SNAPSHOT`,
  `PTT_ACTIVE_SNAPSHOT` ~1.5 s after PTT starts, `PTT_STOP_SNAPSHOT`) with the
  selected candidate pair (`host` / `srflx` / `prflx` / `relay`), protocol,
  RTT, and audio RTP bytes/packets
- `disconnected` vs `failed` distinguished (`ICE_DISCONNECTED_DURATION` records
  how long a peer stays in `disconnected`)
- peer destruction with a reason label: `manual-leave`, `connection-failed`,
  `ice-failed`, `remote-left`, `track-ended`, `application-shutdown`,
  `unknown`
- the Metered ICE configuration (`TURN_CONFIG`): whether `metadata.iceServers`
  arrived in the welcome, the STUN vs TURN/TURNS count, and per-server
  scheme/hostname/port/transport only — never credentials; when Metered
  delivers nothing and the Open Relay fallback is applied, this is reported as
  `TURN_CONFIG_FALLBACK`
- the ICE transport policy (`ICE_POLICY`) when the debug-only `forceRelay=1`
  is active
- per-gathered-candidate lines (`ICE_CANDIDATE`): type (`host` / `srflx` /
  `prflx` / `relay`), protocol (`udp`/`tcp`), address family and relay protocol
  — never addresses or the raw candidate string
- a per-peer gathering summary on `iceGatheringState = complete`
  (`ICE_GATHERED_SUMMARY`): host/srflx/prflx/relay counts plus
  `turnCandidate=YES/NO`

Diagnostics never include access tokens, authorization headers, Metered
secrets or TURN passwords (usernames/passwords are only reported as
"credentials present", never as values).

## Test scenario

Two participants on different networks (e.g. a Windows PC on a normal home
internet connection and a laptop on a mobile hotspot):

1. Join the same Commander Link room with both clients.
2. Wait 20–30 seconds without speaking.
3. Confirm both peers remain connected.
4. Record the selected ICE candidate pair from the diagnostics panel.
5. Press and hold PTT on Client A.
6. Speak for 5–10 seconds.
7. Observe:
   - `connectionState`
   - `iceConnectionState`
   - local track state
   - selected candidate pair
   - RTP counters
   - heartbeat
8. Release PTT.
9. Copy diagnostics from both clients (the `Copy diagnostics` button or the
   console output).

Repeat with the roles reversed (Client B → Client A).

## What the evidence must answer

- A) Does PTT only change `track.enabled`, or does it recreate/remove/stop the
  audio track?
- B) Does PTT trigger WebRTC renegotiation (`negotiationneeded` /
  `SDP_FLOW` lines between `PTT_DOWN` and `PTT_UP`)?
- C) Which ICE path is actually used: `host`, `srflx` or `relay`?
- D) On failure, which changes first: `connectionState` or
  `iceConnectionState`?
- E) Does ICE move `connected → disconnected → failed`?
- F) Does Commander Link destroy the peer itself before WebRTC actually fails?
- G) Does a heartbeat timeout remove the participant?
- H) Does the selected ICE candidate pair change when audio traffic starts?
- I) Do RTP `bytesSent` / `packetsSent` increase while PTT is active?

## ICE configuration (Open Relay fallback)

Metered Realtime's welcome currently delivers **no** `metadata.iceServers`
(verified: `TURN configuration received: NO`, `STUN server count: 0`), which
leaves the SDK's RTCPeerConnections without ICE servers and cross-network calls
stuck in `checking`.

Since the SDK builds every `RTCPeerConnection` internally, the fallback is
injected at the SDK's `rtcPeerConnectionFactory` — the single point every PC
creation passes through (new peers and reconnect PC swaps):

```
Metered welcome iceServers
    ↓
if non-empty → use them (unchanged)
otherwise    → Open Relay fallback (stun/turn/turns: staticauth.openrelay.metered.ca)
```

Production default remains `iceTransportPolicy: "all"`. A debug-only
`?debug=webrtc&forceRelay=1` sets `iceTransportPolicy: "relay"` to force the
relay path for diagnostics only.

The diagnostics panel / `Copy diagnostics` report this as:

- `TURN configuration received: YES/NO` (did Metered send anything)
- `Open Relay fallback applied: YES/NO`
- `forceRelay (debug): YES/NO`
- `STUN server count: N` and `TURN/TURNS server count: N`
- per-server `scheme:hostname:port?transport=` lines (credentials only flagged)

## ICE candidate provisioning (the two decisive questions)

When a real two-network test stays stuck in `iceConnectionState = checking`
with **no selected candidate pair**, the `Copy diagnostics` output answers two
conclusive questions:

- **Q1 — Does the effective ICE configuration include STUN/TURN?** Look at
  `Metered ICE configuration (welcome)`: with the fallback applied this must
  show `STUN server count: 2` and `TURN/TURNS server count: 3` (Open Relay),
  and `Open Relay fallback applied: YES`.
- **Q2 — Does the browser actually gather at least one `relay` candidate?**
  Look at each peer's `ICE candidates gathered:` line and
  `TURN candidate available: YES/NO`, plus the `ICE_CANDIDATE` / `ICE_GATHERED_SUMMARY`
  console lines.

With the fallback active, gathering should normally produce `host > 0`,
`srflx > 0` and `relay > 0`, and two clients on different networks should reach
`iceConnectionState: connected` / `connectionState: connected` with
`bytesSent > 0` / `packetsSent > 0` while PTT is active.

Diagnosis matrix (with the fallback in place):

| STUN/TURN configured | relay candidate gathered | Conclusion |
|---|---|---|
| YES | YES | Cross-network ICE should connect (relay path working) |
| YES | NO | TURN/STUN servers reachable but credentials rejected or gathering blocked (firewall/STUN blocked) |
| NO | NO | Fallback not applied — factory wiring regression |

The next step is to fix based on that evidence, not before.
