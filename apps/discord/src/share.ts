import { RoomIdSchema, RoomMetadataSchema } from "@commander-link/core";

export interface ShareEnvironment {
  commanderLinkApiUrl: string;
  guildId?: string;
  commanderChannelId?: string;
  discordBotToken?: string;
  commanderLinkWebUrl?: string;
}

export class ShareError extends Error {}

// Discord can retry an interaction. This also closes the small double-click
// race within one Worker isolate; the disabled button handles normal UX.
const sharedRooms = new Map<string, Promise<"shared" | "already_shared">>();

export async function shareRoom(
  roomId: string,
  creatorName: string | undefined,
  env: ShareEnvironment
): Promise<"shared" | "already_shared"> {
  console.log("[share] start", {
    roomId,
    hasChannelId: Boolean(env.commanderChannelId),
    hasBotToken: Boolean(env.discordBotToken),
    apiBase: env.commanderLinkApiUrl,
  });
  if (!RoomIdSchema.safeParse(roomId).success) throw new ShareError("invalid_room");
  if (!env.commanderChannelId) throw new ShareError("commander_channel_not_configured");
  if (!env.discordBotToken) throw new ShareError("bot_token_not_configured");

  const existing = sharedRooms.get(roomId);
  if (existing) return existing;
  const operation = publishRoom(roomId, creatorName, env);
  sharedRooms.set(roomId, operation);
  try {
    return await operation;
  } catch (error) {
    sharedRooms.delete(roomId);
    throw error;
  }
}

async function publishRoom(roomId: string, creatorName: string | undefined, env: ShareEnvironment) {
  const base = env.commanderLinkApiUrl.replace(/\/+$/, "");
  let metadataResponse: Response;
  console.log("[share] room metadata request", {
    roomId,
    apiBase: base,
  });
  try {
    metadataResponse = await fetch(`${base}/v1/rooms/${encodeURIComponent(roomId)}`);
  } catch {
    throw new ShareError("api_unreachable");
  }
  console.log("[share] room metadata response", {
    status: metadataResponse.status,
    ok: metadataResponse.ok,
  });
  if (!metadataResponse.ok) throw new ShareError("room_unavailable");
  let metadata: unknown;
  try {
    metadata = await metadataResponse.json();
  } catch {
    throw new ShareError("room_unavailable");
  }
  const parsed = RoomMetadataSchema.safeParse(metadata);
  console.log("[share] room metadata parsed", {
    parseSuccess: parsed.success,
    exists: parsed.success ? parsed.data.exists : undefined,
  });
  if (!parsed.success || !parsed.data.exists) throw new ShareError("room_unavailable");

  const webBase = (env.commanderLinkWebUrl || base).replace(/\/+$/, "");
  const inviteUrl = `${webBase}/r/${roomId}`;
  const appLauncherUrl = `${webBase}/app/${roomId}`;
  const content = `Commander Link\n\n${creatorName || "Ein Commander"} hat einen Commander-Link-Raum geöffnet.\n\nIm Browser öffnen: ${inviteUrl}\nIn der Commander-Link-App öffnen: ${appLauncherUrl}\n\nDer Raum läuft automatisch ab, wenn er nicht mehr benötigt wird.`;
  const discordUrl = `https://discord.com/api/v10/channels/${encodeURIComponent(env.commanderChannelId!)}/messages`;
  const requestInit: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.discordBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        components: [
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: "Im Browser öffnen", url: inviteUrl },
              { type: 2, style: 5, label: "In der Commander-Link-App öffnen", url: appLauncherUrl },
            ],
          },
        ],
      }),
    };

  console.log("[share] discord post start", {
    commanderChannelId: env.commanderChannelId,
  });

  let response: Response;
  try {
    response = await fetch(discordUrl, requestInit);
  } catch {
    console.error("[discord] commander share failed", {
      guildId: env.guildId,
      commanderChannelId: env.commanderChannelId,
      status: undefined,
      discordCode: undefined,
      discordMessage: undefined,
      discordCase: "network_error",
    });
    throw new ShareError("channel_unavailable");
  }

  let errorBody: { code?: number | string; message?: string } | undefined;
  if (!response.ok) {
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === "object") {
        const body = parsed as Record<string, unknown>;
        errorBody = {
          code: typeof body.code === "number" || typeof body.code === "string" ? body.code : undefined,
          message: typeof body.message === "string" ? body.message : undefined,
        };
      }
    } catch {
      // Keep diagnostics safe when Discord returns a non-JSON error response.
    }
  }

  console.log("[share] discord post response", {
    status: response.status,
    discordCode: errorBody?.code,
    discordMessage: errorBody?.message,
  });

  if (!response.ok) {
    console.error("[discord] commander share failed", {
      guildId: env.guildId,
      commanderChannelId: env.commanderChannelId,
      status: response.status,
      discordCode: errorBody?.code,
      discordMessage: errorBody?.message,
      discordCase: classifyDiscordError(response.status, errorBody?.message),
    });
    throw new ShareError("channel_unavailable");
  }
  return "shared" as const;
}

function classifyDiscordError(status: number, message: string | undefined): string {
  if (status === 403 && message === "Missing Permissions") return "missing_permissions";
  if (status === 403 && message === "Missing Access") return "missing_access";
  if (status === 404 && message === "Unknown Channel") return "unknown_channel";
  if (status === 401 && message === "Unauthorized") return "unauthorized";
  if (status === 400 && message === "Invalid Form Body") return "invalid_form_body";
  return "other_discord_error";
}
