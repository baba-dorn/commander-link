# Vendor notes (verified 2026-08-07)

These notes are intentionally dated. Codex must re-check official docs before relying on details that may have changed.

## Metered

Official Metered Open Relay pages currently describe:
- free Realtime Messaging signalling with channels, presence and direct messaging;
- JWT or publishable-key authentication;
- REST token minting using a server-side `sk_id` + `sk_secret` pair;
- token scope fields including channels, permissions and expiry;
- TURN/ICE metadata carried in token/welcome flow;
- `@metered-ca/realtime` as the open-source JS WebRTC helper;
- Open Relay free TURN allowance advertised as 20 GB/month.

For production, this repo requires Worker-minted scoped JWTs rather than a publishable key embedded in clients.

## Cloudflare

Official Cloudflare documentation currently states Durable Objects are available on Workers Free, with new Free-plan Durable Objects using SQLite-backed storage. This project uses a DO only for room/admission coordination, not media or signalling.
