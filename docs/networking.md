# Networking

Metered Open Relay provides TURN fallback; direct WebRTC P2P remains preferred. Metered Realtime Messaging provides signalling and can deliver TURN/ICE metadata as part of the authenticated connection flow.

## Required tests

- direct ICE connection
- forced relay connection
- 2, 3 and 4 peers
- Windows desktop ↔ Windows desktop
- Windows desktop ↔ browser
- Windows ↔ Linux/Steam Deck where available
- reconnect after brief network loss

## Diagnostics

Expose only safe runtime facts such as peer count, WebRTC connection state and selected candidate type. Do not display token contents, TURN username/password or Worker secrets.
