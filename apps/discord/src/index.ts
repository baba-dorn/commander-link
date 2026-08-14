import { readConfig, verifyDiscordRequest, handleInteraction, roomCreatedResponse, roomSharedResponse } from "./discord";
import { createCommanderRoom, CommanderLinkError } from "./commander-link";
import { cleanupExpiredInvitations, shareRoom, ShareError } from "./share";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  COMMANDER_LINK_API_URL: string;
  ROOM_CREATE_SECRET: string;
  DISCORD_BOT_TOKEN?: string;
  COMMANDER_LINK_WEB_URL?: string;
  INVITATION_TRACKING: KVNamespace;
}

const EPHEMERAL = 1 << 6;
const DENIED_MESSAGE =
  "Der Commander-Link-Raum konnte gerade nicht erstellt werden. Bitte versuche es erneut.";

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleInteractions(request: Request, env: Env): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json(400, { error: "bad_request" });
  }

  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  // Fail closed: reject before any parsing when the signature envelope is absent.
  if (!signature || !timestamp) {
    return json(401, { error: "unauthorized" });
  }

  const config = readConfig(env as unknown as Record<string, string | undefined>);
  const verified = await verifyDiscordRequest(config.publicKey, rawBody, signature, timestamp);
  if (!verified) {
    return json(401, { error: "unauthorized" });
  }

  let interaction: unknown;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    // Valid signature but malformed body: fail safe.
    return json(400, { error: "bad_request" });
  }

  const { decision, response, roomId, guildId, guildName, channelId, shareButtonEnabled } = handleInteraction(config, interaction);

  if (decision === "share") {
    const payload = interaction as { user?: { global_name?: string; username?: string } };
    console.log("[share config]", {
      hasCommanderChannelId: Boolean(channelId),
      hasBotToken: Boolean(env.DISCORD_BOT_TOKEN),
      guildId,
      guildName,
    });
    try {
      if (!roomId) throw new ShareError("invalid_room");
      await shareRoom(roomId, payload.user?.global_name ?? payload.user?.username, {
        commanderLinkApiUrl: env.COMMANDER_LINK_API_URL,
        guildId,
        commanderChannelId: channelId,
        discordBotToken: env.DISCORD_BOT_TOKEN,
        commanderLinkWebUrl: env.COMMANDER_LINK_WEB_URL,
        invitationTracking: env.INVITATION_TRACKING,
      });
      // Update the original ephemeral message in place (remove the share
      // button, append the confirmation) instead of creating a second message.
      const webBase = (env.COMMANDER_LINK_WEB_URL || env.COMMANDER_LINK_API_URL).replace(/\/+$/, "");
      return json(200, roomSharedResponse(`${webBase}/r/${roomId}`));
    } catch (err) {
      if (err instanceof ShareError) console.error(`commander-room share failed reason=${err.message}`);
      else console.error("commander-room share failed unexpected");
      return json(200, {
        type: 4,
        data: { content: `Teilen fehlgeschlagen: ${err instanceof ShareError ? err.message : "channel_unavailable"}`, flags: EPHEMERAL },
      });
    }
  }

  if (decision !== "create") {
    return json(200, response);
  }

  try {
    const room = await createCommanderRoom({
      commanderLinkApiUrl: env.COMMANDER_LINK_API_URL,
      roomCreateSecret: env.ROOM_CREATE_SECRET,
    });
    console.log("[discord] using roomCreatedResponse", {
      roomId: room.roomId,
      shareButtonEnabled: Boolean(shareButtonEnabled),
    });
    return json(200, roomCreatedResponse(room.inviteUrl, room.roomId, Boolean(shareButtonEnabled)));
  } catch (err) {
    // Never ship internal detail or credentials back to Discord.
    if (err instanceof CommanderLinkError) {
      console.error(`commander-room creation failed status=${err.status ?? "network"}`);
    } else {
      console.error("commander-room creation failed unexpected");
    }
    return json(200, { type: 4, data: { content: DENIED_MESSAGE, flags: EPHEMERAL } });
  }
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(200, { ok: true });
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/interactions" || url.pathname === "/")
    ) {
      // Discord posts the interaction/PING to exactly the configured endpoint
      // URL. Accept both the canonical `/interactions` and the bare-domain
      // root path so Discord can validate the endpoint regardless of how the
      // Interactions Endpoint URL is entered in the Developer Portal.
      return handleInteractions(request, env);
    }

    return json(404, { error: "not_found" });
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await cleanupExpiredInvitations({
      commanderLinkApiUrl: env.COMMANDER_LINK_API_URL,
      discordBotToken: env.DISCORD_BOT_TOKEN,
      invitationTracking: env.INVITATION_TRACKING,
    });
  },
} satisfies ExportedHandler<Env>;
