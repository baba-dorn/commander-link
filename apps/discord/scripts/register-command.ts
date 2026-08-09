/**
 * Register the `/commander` slash command as a guild command for every
 * enabled guild in apps/discord/config/guilds.json.
 *
 * Development/tooling only. Requires these configuration values (see
 * apps/discord/.dev.vars.example):
 *
 *   DISCORD_APPLICATION_ID
 *   DISCORD_BOT_TOKEN
 *
 * Values are read from the environment, falling back to apps/discord/.dev.vars
 * when present (so `pnpm register:discord:command` works out of the box).
 *
 * Usage (from apps/discord):
 *   pnpm register:command
 *
 * The bot token is a secret and must never be committed. This script is NOT
 * required by the runtime Interaction worker.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import guildConfig from "../config/guilds.json";

const COMMAND = {
  name: "commander",
  description: "Erstellt einen Commander-Link-Raum",
};

function loadDevVars(): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../.dev.vars");
  const vars: Record<string, string> = {};
  try {
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {
    // No .dev.vars present; rely on process.env only.
  }
  return vars;
}

function requiredEnv(name: string): string {
  const value = process.env[name] ?? loadDevVars()[name];
  if (!value) {
    console.error(
      `Missing required value: ${name} (set it in the environment or apps/discord/.dev.vars)`
    );
    process.exit(1);
  }
  return value;
}

async function registerForGuild(applicationId: string, token: string, guildId: string, name: string) {
  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  // PUT is the bulk-overwrite endpoint and expects an ARRAY of command objects.
  // Overwriting is ideal here: the guild's command list becomes exactly `/commander`.
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([COMMAND]),
  });

  const shortId = guildId.length > 4 ? `${guildId.slice(0, 4)}...` : guildId;
  if (!response.ok) {
    throw new Error(`Discord API error ${response.status}`);
  }
  console.log(`✓ ${name} (${shortId})`);
}

async function main(): Promise<void> {
  const applicationId = requiredEnv("DISCORD_APPLICATION_ID");
  const token = requiredEnv("DISCORD_BOT_TOKEN");

  const enabledGuilds = Object.entries(guildConfig.guilds).filter(
    ([, guild]) => guild.enabled
  );

  if (enabledGuilds.length === 0) {
    console.log("No enabled guilds configured in apps/discord/config/guilds.json.");
    return;
  }

  console.log("Registered /commander:");
  const failures: string[] = [];
  for (const [guildId, guild] of enabledGuilds) {
    try {
      await registerForGuild(applicationId, token, guildId, guild.name);
    } catch (err) {
      console.error(`✗ ${guild.name} (${guildId}): ${(err as Error).message}`);
      failures.push(`${guild.name} (${guildId})`);
    }
  }

  if (failures.length > 0) {
    console.error(`Failed for: ${failures.join(", ")}`);
    process.exit(1);
  }
}

void main();
