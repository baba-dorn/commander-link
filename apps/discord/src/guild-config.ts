import { z } from "zod";
import rawConfig from "../config/guilds.json";

/**
 * Versioned multi-guild Discord authorization configuration.
 *
 * Guild IDs and Commander role IDs are NOT secrets: they live in
 * apps/discord/config/guilds.json and are bundled into the deployed Worker, so
 * editing that file and running `pnpm deploy:discord` ships the new
 * authorization configuration without any `wrangler secret put` calls.
 *
 * Real secrets (DISCORD_BOT_TOKEN, ROOM_CREATE_SECRET, ...) must remain Cloudflare
 * secrets and must never be placed in this JSON.
 */
export interface GuildConfig {
  name: string;
  commanderRoleId: string;
  /** Channel receiving shared invitations for this guild. */
  commanderChannelId?: string;
  enabled: boolean;
}

export interface DiscordGuildConfig {
  guilds: Record<string, GuildConfig>;
}

const GuildConfigSchema = z.object({
  name: z.string().min(1),
  commanderRoleId: z.string().min(1),
  commanderChannelId: z.string().regex(/^\d+$/).optional(),
  enabled: z.boolean(),
});

const DiscordGuildConfigSchema = z.object({
  guilds: z.record(z.string().min(1), GuildConfigSchema),
});

/**
 * Validate guild configuration. Throws on malformed input so a bad config
 * fails clearly at startup instead of silently authorizing nobody.
 */
export function validateGuildConfig(value: unknown): DiscordGuildConfig {
  const parsed = DiscordGuildConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `invalid guild configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

/** The guild configuration bundled into this Worker, validated at load time. */
export const GUILD_CONFIG: DiscordGuildConfig = validateGuildConfig(rawConfig);

/**
 * Look up the configured, enabled guild.
 *
 * Returns `null` when the guild is not configured, is disabled, or when any
 * input is missing — always fail-closed. A configured-but-disabled guild also
 * reports disabled via {@link isGuildDisabled}.
 */
export function getGuildConfig(guildId: string | undefined): GuildConfig | null {
  if (!guildId || typeof guildId !== "string") {
    return null;
  }
  const guild = GUILD_CONFIG.guilds[guildId];
  if (!guild || !guild.enabled) {
    return null;
  }
  return guild;
}

/**
 * True when `guildId` is configured in guilds.json but explicitly disabled.
 * Used only to pick a friendlier user-facing message for disabled guilds.
 */
export function isGuildDisabled(guildId: string | undefined): boolean {
  if (!guildId || typeof guildId !== "string") {
    return false;
  }
  const guild = GUILD_CONFIG.guilds[guildId];
  return !!guild && guild.enabled === false;
}
