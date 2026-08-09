import { z } from "zod";

/**
 * Discord HTTP Interactions handling for Commander Link.
 *
 * This module is deliberately small and dependency-light: Discord's public-key
 * signature is verified with the platform Web Crypto Ed25519 primitive rather
 * than a full Discord SDK. It contains the authorization chain for `/commander`
 * and the JSON interaction responses. It performs NO network calls — room
 * creation lives in `commander-link.ts` and HTTP routing in `index.ts`.
 */

export interface DiscordConfig {
  /** Hex-encoded Ed25519 public key from the Discord Developer Portal. */
  publicKey: string;
  /** Discord Application ID (safe identifier). */
  applicationId: string;
  /** Only this guild may create Commander Link rooms. */
  guildId: string;
  /** Only members holding this role id may create rooms. */
  commanderRoleId: string;
}

const DiscordConfigSchema = z.object({
  publicKey: z.string().min(1),
  applicationId: z.string().min(1),
  guildId: z.string().min(1),
  commanderRoleId: z.string().min(1),
});

/** Parse Worker environment into a validated {@link DiscordConfig}. */
export function readConfig(env: Record<string, string | undefined>): DiscordConfig {
  const parsed = DiscordConfigSchema.safeParse({
    publicKey: env.DISCORD_PUBLIC_KEY,
    applicationId: env.DISCORD_APPLICATION_ID,
    guildId: env.DISCORD_GUILD_ID,
    commanderRoleId: env.DISCORD_COMMANDER_ROLE_ID,
  });
  if (!parsed.success) {
    throw new Error("missing or invalid Discord configuration");
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Ed25519 signature verification
// ---------------------------------------------------------------------------

/** Verify `X-Signature-Ed25519` against the raw body using Discord's public key. */
export async function verifyDiscordRequest(
  publicKeyHex: string,
  rawBody: string,
  signatureHex: string,
  timestamp: string
): Promise<boolean> {
  const publicKeyBytes = hexToBytes(publicKeyHex);
  if (publicKeyBytes.length !== 32) return false;
  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = hexToBytes(signatureHex);
  } catch {
    return false;
  }
  if (signatureBytes.length !== 64) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const messageBytes = new TextEncoder().encode(`${timestamp}${rawBody}`);
  const message = new Uint8Array(new ArrayBuffer(messageBytes.byteLength));
  message.set(messageBytes);
  return crypto.subtle.verify("Ed25519", key, signatureBytes, message);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error("invalid hex");
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interaction payload shapes
// ---------------------------------------------------------------------------

const PING_TYPE = 1; // Discord validates the endpoint: receive PING, return PONG.
const APPLICATION_COMMAND_TYPE = 2;

interface InteractionPing {
  type: 1;
}

interface InteractionCommand {
  type: 2;
  data?: { name?: string };
  guild_id?: string;
  member?: {
    roles?: string[];
  };
}

// ---------------------------------------------------------------------------
// Authorization chain
// ---------------------------------------------------------------------------

export type DiscordResponse =
  | { type: 1 } // PONG
  | {
      type: 4;
      data: {
        content?: string;
        flags?: number;
        components?: unknown[];
      };
    };

const EPHEMERAL = 1 << 6;

const WRONG_GUILD_MESSAGE =
  "Dieser Befehl kann nur auf dem vorgesehenen Discord-Server verwendet werden.";
const NO_ROLE_MESSAGE =
  "Du benötigst die Discord-Rolle „Kommandeur“, um einen Commander-Link-Raum zu erstellen.";
const FAILED_MESSAGE = "Der Commander-Link-Raum konnte gerade nicht erstellt werden.";

/**
 * Route an already signature-verified interaction through the authorization
 * chain. Fail-closed: only a verified, in-guild, guild-member with the
 * Commander role id proceeds to room creation.
 */
export function handleInteraction(
  config: DiscordConfig,
  interaction: unknown
): { decision: "pong" | "create" | "deny" | "unknown"; response: DiscordResponse } {
  const ping = interaction as InteractionPing;
  if (ping && ping.type === PING_TYPE) {
    return { decision: "pong", response: { type: 1 } };
  }

  const cmd = interaction as InteractionCommand;
  if (!cmd || cmd.type !== APPLICATION_COMMAND_TYPE || !cmd.data || cmd.data.name !== "commander") {
    // Unknown / unsupported interaction: fail safely and predictably.
    return {
      decision: "unknown",
      response: { type: 4, data: { content: FAILED_MESSAGE, flags: EPHEMERAL } },
    };
  }

  if (cmd.guild_id !== config.guildId) {
    return {
      decision: "deny",
      response: { type: 4, data: { content: WRONG_GUILD_MESSAGE, flags: EPHEMERAL } },
    };
  }

  const roles = cmd.member?.roles ?? [];
  if (!Array.isArray(roles) || !roles.includes(config.commanderRoleId)) {
    return {
      decision: "deny",
      response: { type: 4, data: { content: NO_ROLE_MESSAGE, flags: EPHEMERAL } },
    };
  }

  return { decision: "create", response: { type: 4, data: { flags: EPHEMERAL } } as DiscordResponse };
}

/** Build the ephemeral success response describing a fresh invite. */
export function roomCreatedResponse(inviteUrl: string): DiscordResponse {
  return {
    type: 4,
    data: {
      content: `Commander-Link-Raum erstellt.\n\n${inviteUrl}\n\nDer Raum läuft automatisch ab, wenn er nicht mehr benötigt wird.`,
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 5, label: "Commander Link öffnen", url: inviteUrl },
          ],
        },
      ],
    },
  };
}


