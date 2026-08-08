# Commander Link — Discord Interaction Worker (`@commander-link/discord`)

Adds **Discord** as an entry point for creating Commander Link rooms.

A server member holding the configured Commander role runs the `/commander` slash
command. This Discord Worker verifies the request signature, the guild, and the
role, then asks the **existing** Commander Link API Worker
(`commander-link-api`, `apps/worker`) to create the room. There is exactly **one**
room-creation implementation — the existing Worker — and this app simply triggers it.

```text
Discord
   │  /commander
   ▼
apps/discord  (commander-link-discord Worker)
   ├─ verify Discord Ed25519 signature
   ├─ verify guild  == DISCORD_GUILD_ID
   ├─ verify member has DISCORD_COMMANDER_ROLE_ID
   ▼
server-to-server POST /v1/rooms
   ▼
apps/worker  (commander-link-api)
   └─ existing createRoom() → RoomGate → invite URL
```

This app is **not** a Discord bot/Gateway, does not do voice, and does not
re-implement room lifecycle, Durable Objects, TTL, Metered tokens or invite URL
generation. It is solely *authorization + room creation trigger*.

---

## Transitional rollout & planned lockdown (important)

Currently **two** paths can create rooms; both call the same `createRoom()`:

| Phase | App (browser/desktop) room creation | Discord `/commander` room creation |
| --- | --- | --- |
| **1 (this task)** | allowed (unchanged) | allowed |
| **2 (later)** | disabled | authorized only |

For Phase 1 the existing `POST /v1/rooms` endpoint is intentionally **not**
protected, so current browser/Electron "Create room" keeps working while the
Discord path is tested in production.

The Discord worker already authenticates permanently via
`Authorization: Bearer <ROOM_CREATE_SECRET>` (see `src/commander-link.ts`). To
later make Discord the exclusive path, apply only these minimal changes:

1. In `apps/worker/src/index.ts`, in `createRoom()` (or the `POST /v1/rooms`
   route), require `Authorization: Bearer ${env.ROOM_CREATE_SECRET}` and return
   `401`/`403` otherwise. Use a constant-time compare.
2. Add `ROOM_CREATE_SECRET` to `apps/worker` as a **Wrangler secret** (and to
   `apps/worker/.dev.vars` for local dev).
3. The web app's `createRoom()` (`apps/web/src/api.ts`) and its "Raum erstellen"
   UI can then either be removed or pointed at a Discord-driven flow.

Do **not** change join, leave, heartbeat, metadata or VoiceBackend behavior.

---

## Configuration

### Runtime variables (safe identifiers — may be Worker `[vars]` or secrets)

| Variable | Purpose |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Hex Ed25519 public key from the Developer Portal. Used to verify interaction signatures. |
| `DISCORD_APPLICATION_ID` | Discord Application ID. |
| `DISCORD_GUILD_ID` | Only this guild may create rooms. |
| `DISCORD_COMMANDER_ROLE_ID` | Only members with this **role id** may create rooms (id, never the name). |
| `COMMANDER_LINK_API_URL` | Base URL of the Commander Link API Worker (e.g. `https://commander-link-api.<account>.workers.dev`). |

### Secrets (never commit; never returned to clients)

| Variable | Purpose |
| --- | --- |
| `ROOM_CREATE_SECRET` | Server-to-server secret for `POST /v1/rooms`. Sent by this worker; enforced by the API worker in Phase 2. |
| `DISCORD_BOT_TOKEN` | **Tooling only** — used solely by `scripts/register-command.ts`. Not required by the runtime worker. |

Copy `apps/discord/.dev.vars.example` → `.dev.vars` for `wrangler dev`.

---

## Discord Developer Portal setup (manual)

1. **Create/select the Discord Application** at the [Developer Portal](https://discord.com/developers/applications).
2. Copy the **Application ID** (General Information).
3. Copy the **Public Key** (General Information).
4. Configure the **Interactions Endpoint URL** (General Information):
   `https://commander-link-discord.<account>.workers.dev/interactions`
   Discord validates the endpoint by sending a signed `PING`; this worker returns
   `PONG`, so the endpoint becomes "Saved" automatically.
5. **Authorize/install the bot** into the target guild with an install flow /
   OAuth app scope that includes the **`applications.commands`** scope (a slash
   command application, not a presence/message bot, is enough).
6. Obtain the **Guild ID**: enable Developer Mode (Settings → Advanced → Developer
   Mode), right-click the server → **Copy Server ID**.
7. Obtain the **Commander role id**: with Developer Mode enabled, right-click the
   role (Server Settings → Roles) → **Copy Role ID**. Set this as
   `DISCORD_COMMANDER_ROLE_ID`. Do not rely on the human-readable name
   `"Kommandeur"` — authorize by id.
8. Configure the Worker variables/secrets (see below) and deploy.
9. Register `/commander` as a guild command (see below).
10. Test with: a Commander-role member, a normal member, a different guild (if
    practical), and an invalid/unsigned request.

### Optional Discord-side visibility (defense-in-depth only)

The **server-side role check is the actual security boundary.** Additionally, the
server administrator can restrict `/commander` to the `Kommandeur` role in
Server Settings → Integrations → App → `commander` → edit command permissions so
the command is only visible/usable by that role. This is UX/defense-in-depth only
and must never be relied on as the sole authorization mechanism.

---

## Local development

Wire the Discord worker to a local API worker so room creation round-trips:

```powershell
# Terminal 1 — existing API worker on :8788
pnpm dev:worker

# Terminal 2 — Discord worker
cd apps/discord
copy .dev.vars.example .dev.vars   # fill in real values
pnpm dev
```

`wrangler dev` will print a local URL; POST valid signed requests to
`/interactions`.

---

## Deploy

```powershell
# Configure secrets once (never commit them)
cd apps/discord
wrangler secret put ROOM_CREATE_SECRET
wrangler secret put DISCORD_BOT_TOKEN        # optional; only for the register script
cd ../..

# Set non-secret vars in apps/discord/wrangler.toml [vars] or as secrets:
#   DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID,
#   DISCORD_COMMANDER_ROLE_ID, COMMANDER_LINK_API_URL

# Deploy
pnpm deploy:discord    # = wrangler deploy (worker: commander-link-discord)

# Then point the Interactions Endpoint at
#   https://commander-link-discord.<account>.workers.dev/interactions
```

Do **not** set the actual Discord configuration or secrets in `wrangler.toml` in a
way that is committed. Keep secrets in `wrangler secret` + local `.dev.vars`.

---

## Registering `/commander`

Guild commands update quickly and only appear on the target server, which is
right for the current single-guild target.

```powershell
# from repo root
pnpm register:discord:command
# or from apps/discord:
pnpm register:command
```

Requires these environment variables: `DISCORD_APPLICATION_ID`,
`DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`. Provide them on the command line or via
`.dev.vars` (the script reads `process.env`; for a shell prompt, export them or
use dotenv-style tooling — the token is a secret and must never be committed).

---

## Tests

```powershell
pnpm --filter @commander-link/discord test     # vitest
pnpm --filter @commander-link/discord typecheck
pnpm --filter @commander-link/discord build    # wrangler deploy --dry-run
```
