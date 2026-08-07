# AGENTS.md — Codex contract

You are implementing **Commander Link**. Read `README.md`, `docs/product.md`, `docs/architecture.md`, `docs/security.md`, and `TASKS.md` before changing code.

## Non-negotiable product boundary

Commander Link is a **parallel private commander backchannel beside Discord**. Discord is already handling the main raid. Do not add Discord voice, general chat, servers, friends, channels, video, recording, transcription, accounts, or social features.

## Technical invariants

- Use `@metered-ca/realtime` for managed signalling/WebRTC negotiation/reconnect where its current API supports the required flow.
- Do not rebuild SDP/ICE signalling in Cloudflare.
- Open Relay TURN is fallback; direct P2P is preferred by WebRTC.
- Never expose Metered `sk_id` / `sk_secret` credentials to browser bundles, Electron renderer, preload, logs, tests or committed files.
- Tokens must be minted server-side and scoped to one room/channel with short expiry.
- Room capacity is hard-limited to 4 admitted peers.
- A room expires no later than configured TTL (default 6 hours).
- Start muted. Any ambiguity/error/focus loss/disconnect/IPC failure must result in muted transmission.
- PTT semantics are hold-to-talk only: press => transmit, release => mute. No toggle-to-talk in MVP.
- Desktop default global PTT is F8, configurable later.
- Browser PTT uses Pointer Events and must mute on pointerup, pointercancel, pointerleave, window blur, visibility hidden, pagehide and disconnect.
- Electron renderer must not receive Node.js access. Keep `contextIsolation: true`, `nodeIntegration: false`, narrow typed preload API.
- Deep-link scheme: `commanderlink://join/<room-id>`.
- Primary invite stays HTTPS: `/r/<room-id>` so a browser is always a valid fallback.
- Audio only. Official client must request no camera/video tracks.

## Cloudflare boundary

A SQLite-backed Durable Object may be used only as an admission/room state coordinator. It must not proxy media and must not become a custom signalling server.

The Worker owns:
- room creation,
- room existence/expiry,
- capacity/admission bookkeeping,
- rate limiting hooks,
- Metered token minting,
- safe CORS/origin handling,
- health endpoint.

Metered owns:
- realtime signalling,
- peer presence/discovery used by WebRTC,
- SDP/ICE exchange through its SDK/protocol,
- TURN metadata delivery,
- reconnect/ICE restart where supplied by the SDK.

## Implementation behavior

- Work through `TASKS.md` in order.
- Mark tasks complete only when code + tests + docs meet acceptance criteria.
- Prefer small pure modules and explicit state machines for PTT/admission logic.
- Add tests for every security invariant before adding convenience features.
- If Metered SDK behavior differs from these docs, verify current official Metered documentation, document the difference, and adapt without weakening secret isolation or room scoping.
- If Cloudflare APIs changed, use current official Cloudflare Worker/Durable Object syntax.
- Do not silently swap in another hosted WebRTC vendor.

## Definition of done

MVP is done only when all of the following pass:

1. Browser-to-browser audio for 2–4 peers.
2. Desktop-to-browser and desktop-to-desktop audio.
3. Everyone joins muted.
4. F8 hold/release works globally while another app has focus on Windows.
5. Browser red-button hold/release is reliable and fails closed.
6. Fifth peer is denied.
7. Expired rooms cannot mint new join tokens.
8. No Metered secret appears in built client assets.
9. Same HTTPS invite can be used by browser or routed to desktop via deep link.
10. Reconnect after a short network interruption returns muted.
11. TURN fallback can be demonstrated and diagnosed without logging credentials.
12. CI runs lint/typecheck/tests/build.
