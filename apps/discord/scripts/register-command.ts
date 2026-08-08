/**
 * Register the `/commander` slash command as a guild command.
 *
 * Development/tooling only. Requires these environment variables (see
 * apps/discord/.dev.vars.example):
 *
 *   DISCORD_APPLICATION_ID
 *   DISCORD_GUILD_ID
 *   DISCORD_BOT_TOKEN
 *
 * Usage (from apps/discord):
 *   pnpm register:command
 *
 * The bot token is a secret and must never be committed. This script is NOT
 * required by the runtime Interaction worker.
 */

const COMMAND = {
  name: "commander",
  description: "Erstellt einen Commander-Link-Raum",
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const applicationId = requiredEnv("DISCORD_APPLICATION_ID");
  const guildId = requiredEnv("DISCORD_GUILD_ID");
  const token = requiredEnv("DISCORD_BOT_TOKEN");

  const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(COMMAND),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`Discord API error ${response.status}: ${body}`);
    process.exit(1);
  }
  console.log(`Registered /commander for guild ${guildId} (${response.status}).`);
}

void main();
