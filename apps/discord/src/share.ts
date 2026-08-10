import { RoomIdSchema, RoomMetadataSchema } from "@commander-link/core";

export interface ShareEnvironment {
  commanderLinkApiUrl: string;
  guildId?: string;
  commanderChannelId?: string;
  discordBotToken?: string;
  commanderLinkWebUrl?: string;
  invitationTracking: KVNamespace;
}

export class ShareError extends Error {}

// Discord can retry an interaction. This also closes the small double-click
// race within one Worker isolate; the disabled button handles normal UX.
const sharedRooms = new Map<string, Promise<"shared" | "already_shared">>();

export interface SharedInvitation {
  roomId: string;
  guildId?: string;
  channelId: string;
  messageId: string;
  createdAt: string;
}

export const INVITATION_KEY_PREFIX = "invitation:";

function invitationKey(roomId: string): string {
  return `${INVITATION_KEY_PREFIX}${roomId}`;
}

async function getTrackedInvitation(roomId: string, store: KVNamespace): Promise<SharedInvitation | null> {
  const value = await store.get(invitationKey(roomId), "json");
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SharedInvitation>;
  if (record.roomId !== roomId || typeof record.channelId !== "string" || typeof record.messageId !== "string" || typeof record.createdAt !== "string") return null;
  return record as SharedInvitation;
}

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

  if (await getTrackedInvitation(roomId, env.invitationTracking)) return "already_shared";
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
    const discordMessage = errorBody?.message
      ?.replace(/[\r\n\t]/g, " ")
      .slice(0, 200);
    console.error("[share] discord post failed", {
      status: response.status,
      discordCode: errorBody?.code,
      discordMessage,
      commanderChannelId: env.commanderChannelId,
    });
    throw new ShareError(
      `channel_unavailable:http_${response.status}:discord_${errorBody?.code ?? "unknown"}:${discordMessage ?? "unknown"}`
    );
  }
  let discordMessage: unknown;
  try {
    discordMessage = await response.json();
  } catch {
    throw new ShareError("channel_unavailable");
  }
  const messageId = discordMessage && typeof discordMessage === "object" &&
    typeof (discordMessage as Record<string, unknown>).id === "string"
    ? (discordMessage as Record<string, unknown>).id as string
    : undefined;
  if (!messageId) throw new ShareError("channel_unavailable");

  await env.invitationTracking.put(invitationKey(roomId), JSON.stringify({
    roomId,
    guildId: env.guildId,
    channelId: env.commanderChannelId!,
    messageId,
    createdAt: new Date().toISOString(),
  } satisfies SharedInvitation));
  return "shared" as const;
}

export async function cleanupExpiredInvitations(env: Pick<ShareEnvironment, "commanderLinkApiUrl" | "discordBotToken" | "invitationTracking">): Promise<void> {
  if (!env.discordBotToken) {
    console.error("[discord-cleanup] bot token unavailable");
    return;
  }
  let cursor: string | undefined;
  do {
    const page = await env.invitationTracking.list({ prefix: INVITATION_KEY_PREFIX, cursor });
    for (const key of page.keys) {
      const record = await getTrackedInvitation(key.name.slice(INVITATION_KEY_PREFIX.length), env.invitationTracking);
      if (!record) continue;
      console.log("[discord-cleanup] checking", { roomId: record.roomId, channelId: record.channelId, messageId: record.messageId });

      let metadataResponse: Response;
      try {
        metadataResponse = await fetch(`${env.commanderLinkApiUrl.replace(/\/+$/, "")}/v1/rooms/${encodeURIComponent(record.roomId)}`);
      } catch {
        console.log("[discord-cleanup] commander api unavailable", { roomId: record.roomId });
        continue;
      }
      if (!metadataResponse.ok) {
        console.log("[discord-cleanup] commander api unavailable", { roomId: record.roomId, status: metadataResponse.status });
        continue;
      }
      let metadata: unknown;
      try { metadata = await metadataResponse.json(); } catch { continue; }
      const parsed = RoomMetadataSchema.safeParse(metadata);
      if (!parsed.success) continue;
      if (parsed.data.exists) {
        console.log("[discord-cleanup] room still active", { roomId: record.roomId });
        continue;
      }

      let deletion: Response;
      try {
        deletion = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(record.channelId)}/messages/${encodeURIComponent(record.messageId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bot ${env.discordBotToken}` },
        });
      } catch {
        console.error("[discord-cleanup] discord deletion failed", { roomId: record.roomId, messageId: record.messageId, reason: "network_error" });
        continue;
      }
      let deletionCode: number | string | undefined;
      if (!deletion.ok) {
        try {
          const body = await deletion.json() as Record<string, unknown>;
          if (typeof body.code === "number" || typeof body.code === "string") deletionCode = body.code;
        } catch { /* safe diagnostics only */ }
      }
      if (!deletion.ok && !(deletion.status === 404 || String(deletionCode) === "10008")) {
        console.error("[discord-cleanup] discord deletion failed", { roomId: record.roomId, messageId: record.messageId, status: deletion.status, discordCode: deletionCode });
        continue;
      }
      await env.invitationTracking.delete(invitationKey(record.roomId));
      console.log("[discord-cleanup] deleted expired invitation", { roomId: record.roomId, messageId: record.messageId });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}
