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

Diagnostics never include access tokens, authorization headers, Metered
secrets or TURN passwords.

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

The next step is to fix based on that evidence, not before.
