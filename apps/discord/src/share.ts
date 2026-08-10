import { RoomIdSchema, RoomMetadataSchema } from "@commander-link/core";

export interface ShareEnvironment {
  commanderLinkApiUrl: string;
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
  if (!RoomIdSchema.safeParse(roomId).success) throw new ShareError("invalid_room");
  if (!env.commanderChannelId || !env.discordBotToken) throw new ShareError("not_configured");

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
  try {
    metadataResponse = await fetch(`${base}/v1/rooms/${encodeURIComponent(roomId)}`);
  } catch {
    throw new ShareError("api_unreachable");
  }
  if (!metadataResponse.ok) throw new ShareError("room_unavailable");
  let metadata: unknown;
  try {
    metadata = await metadataResponse.json();
  } catch {
    throw new ShareError("room_unavailable");
  }
  const parsed = RoomMetadataSchema.safeParse(metadata);
  if (!parsed.success || !parsed.data.exists) throw new ShareError("room_unavailable");

  const webBase = (env.commanderLinkWebUrl || base).replace(/\/+$/, "");
  const inviteUrl = `${webBase}/r/${roomId}`;
  const appLauncherUrl = `${webBase}/app/${roomId}`;
  const content = `Commander Link\n\n${creatorName || "Ein Commander"} hat einen Commander-Link-Raum geöffnet.\n\nIm Browser öffnen: ${inviteUrl}\nIn der Commander-Link-App öffnen: ${appLauncherUrl}\n\nDer Raum läuft automatisch ab, wenn er nicht mehr benötigt wird.`;
  const response = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(env.commanderChannelId!)}/messages`,
    {
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
    }
  );
  if (!response.ok) throw new ShareError("channel_unavailable");
  return "shared" as const;
}
