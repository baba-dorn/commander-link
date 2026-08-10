# Commander Link — Discord Interaction Worker (`@commander-link/discord`)

Adds **Discord** as an entry point for creating Commander Link rooms.

A server member holding the configured Commander role runs the `/commander` slash
command. This Discord Worker verifies the request signature, the guild, and the
per-guild role, then asks the **existing** Commander Link API Worker
(`commander-link-api`, `apps/worker`) to create the room. There is exactly **one**
room-creation implementation — the existing Worker — and this app simply triggers it.

The resulting Discord message publishes **two** links to the same room: an HTTPS
browser invite and a `commanderlink://` deep link that opens the installed
Electron app.

```text
Discord
   │  /commander
   ▼
apps/discord  (commander-link-discord Worker)
   ├─ verify Discord Ed25519 signature
   ├─ look up guild in config/guilds.json (enabled + commanderRoleId)
   ├─ verify member has that guild's commanderRoleId
   ▼
server-to-server POST /v1/rooms   (Authorization: Bearer ROOM_CREATE_SECRET)
   ▼
apps/worker  (commander-link-api)
   └─ authorized createRoom() → RoomGate → invite URL
   ▼
Discord publishes  https://…/r/<id>   +   commanderlink://join/<id>
```

The same Discord Application can operate on **multiple** guilds simultaneously.
Which guilds are enabled and which Commander role id each requires is versioned
in `apps/discord/config/guilds.json` (bundled into the Worker), not in
environment variables.

This app is **not** a Discord bot/Gateway, does not do voice, and does not
re-implement room lifecycle, Durable Objects, TTL, Metered tokens or invite URL
generation. It is solely *authorization + room creation trigger*.

---

## Discard is the only room-creation path (important)

Room creation is **Discord-authorized and Discord-only**. The public web app no
longer offers a "create room" flow, and the API worker rejects anonymous create
requests (`401`). There is exactly one room-creation implementation — the Worker
endpoint `POST /v1/rooms` — and the Discord worker is its only authorized caller,
authenticating with the shared `ROOM_CREATE_SECRET` (`Authorization: Bearer
<secret>`, enforced by the Worker).

Joining an existing room is unaffected: invited participants open the browser
invite or the `commanderlink://` deep link and join without any Discord
credentials or creator privileges.

For this lockdown the Worker requires `ROOM_CREATE_SECRET` on `POST /v1/rooms`
and returns `401` otherwise. Join, leave, heartbeat, metadata and VoiceBackend
behavior are unchanged.

---

## Sharing a room

`/commander` remains an ephemeral private response. With
`commanderChannelId` configured for the current guild and `DISCORD_BOT_TOKEN`, it also contains
**An Commander senden**. An authorized Commander can publish the existing room
invitation to that channel; sharing never creates a second room. Discord channel
permissions determine who can see the invitation.

The application needs **View Channel**, **Send Messages**, and **Embed Links**
in the configured channel. Administrator permission is not required.

The target is configured per guild in `config/guilds.json`:

```json
"commanderChannelId": "<discord-channel-id>"
```

## Configuration

### Guild configuration (`apps/discord/config/guilds.json`)

The real `apps/discord/config/guilds.json` is **gitignored** deploy-time config
(per-guild authorization). A committed template lives at
`apps/discord/config/guilds.example.json`; copy it to a real file before running
the Discord worker or its tests:

```powershell
copy apps\discord\config\guilds.example.json apps\discord\config\guilds.json
```

CI restores `guilds.json` from `guilds.example.json` automatically before
typecheck/test/build, so a fresh checkout verifies against the canonical example
config. For local, edit the copied `guilds.json` with your real guild/role ids.

Which Discord guilds may use `/commander`, and the **Commander role id** each
requires, is configured in this versioned JSON:

```json
{
  "guilds": {
    "450409169795678229": {
      "name": "Commander Link Test",
      "commanderRoleId": "1249351808522915991",
      "enabled": true
    },
    "333333333333333333": {
      "name": "OOPS",
      "commanderRoleId": "444444444444444444",
      "enabled": true
    }
  }
}
```

| Field | Purpose |
| --- | --- |
| `guilds.<id>` | Discord **Guild ID** (Developer Mode → right-click server → Copy Server ID). This is the key used to look up the guild. |
| `name` | Human-readable label for reports/logs. |
| `commanderRoleId` | The **role id** (never the name) that may create rooms **on this guild**. |
| `enabled` | `false` disables `/commander` for the guild without deleting its config. |

Guild IDs and role IDs are **not secrets** and may be committed/versioned. The
file is bundled into the Worker: edit it, then run `pnpm deploy:discord`.

**Never** put `DISCORD_BOT_TOKEN`, `ROOM_CREATE_SECRET`, or any other secret in
`guilds.json`.

### Runtime variables (safe identifiers — may be Worker `[vars]` or secrets)

| Variable | Purpose |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Hex Ed25519 public key from the Developer Portal. Used to verify interaction signatures. |
| `DISCORD_APPLICATION_ID` | Discord Application ID. |
| `COMMANDER_LINK_API_URL` | Base URL of the Commander Link API Worker (e.g. `https://commander-link-api.<account>.workers.dev`). |
| `COMMANDER_LINK_WEB_URL` | Public web origin used for shared browser and app links. |

The Worker stores each published invitation in the `INVITATION_TRACKING` KV
namespace. The configured Cron Trigger (`*/5 * * * *`) checks
`GET /v1/rooms/:roomId`; only `exists: false` permits deletion of the exact
tracked Discord message. API outages, malformed responses, permission errors,
and other temporary Discord failures retain the record for a later retry.

`DISCORD_GUILD_ID` and `DISCORD_COMMANDER_ROLE_ID` are **no longer used** — per-guild
authorization now comes from `config/guilds.json`.

### Secrets (never commit; never returned to clients)

`DISCORD_BOT_TOKEN` is required at runtime when invitation sharing is enabled;
it is used only for the server-side Discord REST message call (and command
registration) and is never sent to clients.

| Variable | Purpose |
| --- | --- |
| `ROOM_CREATE_SECRET` | Server-to-server secret for `POST /v1/rooms`. Sent by this worker as `Bearer <secret>` and **enforced** by the API worker: requests without it are rejected. |
| `DISCORD_BOT_TOKEN` | Runtime Discord REST authorization for publishing and deleting tracked invitations; also used by `scripts/register-command.ts`. |

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
   role (Server Settings → Roles) → **Copy Role ID**. Do not rely on the human-readable
   name `"Kommandeur"` — authorize by id. Put both into `config/guilds.json` (see
   "Adding another Discord server").
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

## Adding another Discord server

The same Discord Application can be installed on additional servers. Each server
gets its own entry in `apps/discord/config/guilds.json` with its own Commander role id.

1. **Install the same Discord Application** on the new server using the same
   install flow / OAuth app scope (`applications.commands`).
2. **Enable Discord Developer Mode**: Settings → Advanced → Developer Mode.
3. **Copy the Guild ID**: right-click the server → Copy Server ID.
4. **Copy the Commander role id**: with Developer Mode enabled, Server Settings →
   Roles → right-click the Commander role → Copy Role ID.
5. **Add both to `apps/discord/config/guilds.json`**:

   ```json
   "450409169795678229": {
     "name": "Commander Link Test",
     "commanderRoleId": "1249351808522915991",
     "enabled": true
   }
   ```

6. Set `"enabled": true`.
7. **Deploy** the new authorization configuration:

   ```powershell
   pnpm deploy:discord
   ```

   `pnpm deploy:discord` bundles `guilds.json` into the Worker, so the new guild
   is immediately authorized. It does **not** install the `/commander` command.
8. **Register the guild command** so `/commander` appears on the new server:

   ```powershell
   pnpm register:discord:command
   ```

9. **Test** `/commander` with:
   - a member holding the Commander role → should create a room;
   - a normal member → should be denied.

> **Tip:** `pnpm deploy:discord` updates the Worker *authorization* configuration.
> A brand-new guild additionally needs the `/commander` command **installed** via
> `pnpm register:discord:command`. Worker deployment and command registration are
> two separate steps.

### Disabling a server

To temporarily disable a server without deleting its configuration, set
`"enabled": false`:

```json
{
  "guilds": {
    "450409169795678229": {
      "name": "Commander Link Test",
      "commanderRoleId": "1249351808522915991",
      "enabled": false
    }
  }
}
```

Then run:

```powershell
pnpm deploy:discord
```

The guild is then denied (returns "Commander Link ist auf diesem Discord-Server
derzeit deaktiviert.") with no room creation. To re-enable, flip `enabled` back to
`true` and deploy again.

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

# Create the persistent invitation store once, then put its id in
# apps/discord/wrangler.toml as INVITATION_TRACKING.
cd apps/discord
wrangler kv namespace create INVITATION_TRACKING
cd ../..

# Set non-secret vars in apps/discord/wrangler.toml [vars] or as secrets:
#   DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, COMMANDER_LINK_API_URL

# Per-guild authorization comes from apps/discord/config/guilds.json (bundled).
# DISCORD_GUILD_ID / DISCORD_COMMANDER_ROLE_ID are no longer used.

# Deploy
pnpm deploy:discord    # = wrangler deploy (worker: commander-link-discord)

# The Worker runs invitation cleanup automatically every five minutes.

# Then point the Interactions Endpoint at
#   https://commander-link-discord.<account>.workers.dev/interactions
```

Do **not** set the actual Discord configuration or secrets in `wrangler.toml` in a
way that is committed. Keep secrets in `wrangler secret` + local `.dev.vars`.

---

## Registering `/commander`

Registers the `/commander` guild command for **every enabled guild** in
`apps/discord/config/guilds.json`.

```powershell
# from repo root
pnpm register:discord:command
# or from apps/discord:
pnpm register:command
```

Requires these environment variables: `DISCORD_APPLICATION_ID`,
`DISCORD_BOT_TOKEN`. Provide them on the command line or via `.dev.vars` (the
script reads `process.env`; for a shell prompt, export them or use dotenv-style
tooling — the token is a secret and must never be committed). `DISCORD_GUILD_ID` is
no longer required; enabled guilds are read from `guilds.json`.

---

## Tests

```powershell
pnpm --filter @commander-link/discord test     # vitest
pnpm --filter @commander-link/discord typecheck
pnpm --filter @commander-link/discord build    # wrangler deploy --dry-run
```
