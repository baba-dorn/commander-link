import { readConfig, verifyDiscordRequest, handleInteraction, roomCreatedResponse } from "./discord";
import { createCommanderRoom, CommanderLinkError } from "./commander-link";

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_COMMANDER_ROLE_ID: string;
  COMMANDER_LINK_API_URL: string;
  ROOM_CREATE_SECRET: string;
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

  const { decision, response } = handleInteraction(config, interaction);

  if (decision !== "create") {
    return json(200, response);
  }

  try {
    const room = await createCommanderRoom({
      commanderLinkApiUrl: env.COMMANDER_LINK_API_URL,
      roomCreateSecret: env.ROOM_CREATE_SECRET,
    });
    return json(200, roomCreatedResponse(room.inviteUrl));
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

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteractions(request, env);
    }

    return json(404, { error: "not_found" });
  },
} satisfies ExportedHandler<Env>;
