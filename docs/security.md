# Security and abuse controls

## Threats

1. Extracting credentials from public web/Electron assets.
2. Reusing the service to create arbitrary unrelated rooms.
3. Consuming TURN/signalling quota with automated joins.
4. Bypassing the 4-peer limit via racing requests.
5. Stuck microphone after key/focus/network failure.
6. Leaking TURN credentials/tokens through diagnostics/logs.

## Required controls

- Metered secret key pair only in Worker secrets.
- Server-created opaque room IDs.
- Exact-channel scoped, short-lived Metered JWTs.
- Serialized admission in a per-room Durable Object.
- TTL for room and admission leases.
- Max 4 admitted peers.
- Create/join rate-limit hooks and sane request body limits.
- CORS allowlist based on configured app origin; desktop-specific request strategy must be documented rather than using `*` blindly.
- Never store tokens in analytics/logs.
- Redact Authorization headers.
- Fail-closed PTT state machine.

## Important limitation

The official client can be restricted to audio-only, but a hostile custom client may attempt different WebRTC behavior. Quota protection therefore must rely on credential scope, admission, expiry and rate controls, not only UI restrictions.
