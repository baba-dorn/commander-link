/**
 * Register the `/commander` slash command as a guild command.
 *
 * Development/tooling only. Requires these configuration values (see
 * apps/discord/.dev.vars.example):
 *
 *   DISCORD_APPLICATION_ID
 *   DISCORD_GUILD_ID
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

async function main(): Promise<void> {
  const applicationId = requiredEnv("DISCORD_APPLICATION_ID");
  const guildId = requiredEnv("DISCORD_GUILD_ID");
  const token = requiredEnv("DISCORD_BOT_TOKEN");

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

  const body = await response.text();
  if (!response.ok) {
    console.error(`Discord API error ${response.status}: ${body}`);
    process.exit(1);
  }
  console.log(`Registered /commander for guild ${guildId} (${response.status}).`);
}

void main();
