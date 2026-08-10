import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleInteraction,
  roomCreatedResponse,
  verifyDiscordRequest,
  type DiscordConfig,
} from "../src/discord";
import {
  validateGuildConfig,
  getGuildConfig,
  isGuildDisabled,
} from "../src/guild-config";
import { handleInteractions, type Env } from "../src/index";

// Guild A and B come from the bundled apps/discord/config/guilds.json. The
// committed canonical test config is apps/discord/config/guilds.example.json,
// which CI copies to guilds.json before running checks.
const GUILD_A = "450409169795678229";
const ROLE_A = "1249351808522915991";
const GUILD_B = "333333333333333333";
const ROLE_B = "444444444444444444";
const GUILD_DISABLED = "555555555555555555";
const ROLE_DISABLED = "666666666666666666";

const CONFIG: DiscordConfig = {
  publicKey: "placeholder-hex",
  applicationId: "999999999999999999",
};

let secretKey: CryptoKey;
let publicKeyHex: string;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  secretKey = pair!.privateKey;
  const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair!.publicKey));
  publicKeyHex = bytesToHex(rawPub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sign(raw: string): Promise<{ signature: string; timestamp: string }> {
  const timestamp = "1700000000";
  // Discord signs `timestamp + rawBody` WITHOUT a separator newline.
  const message = new TextEncoder().encode(`${timestamp}${raw}`);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", secretKey, message));
  return { signature: bytesToHex(sig), timestamp };
}

function commanderInteraction(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 2,
    data: { name: "commander" },
    guild_id: GUILD_A,
    member: { roles: [ROLE_A] },
    ...overrides,
  });
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_APPLICATION_ID: "999999999999999999",
    COMMANDER_LINK_API_URL: "http://api.example",
    ROOM_CREATE_SECRET: "it-is-a-secret",
    ...overrides,
  };
}

async function signedPost(raw: string, env: Env): Promise<{ status: number; body: unknown }> {
  const { signature, timestamp } = await sign(raw);
  const response = await handleInteractions(
    new Request("https://discord.example/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": timestamp,
      },
      body: raw,
    }),
    env
  );
  return { status: response.status, body: await response.json() };
}

function mockApiFetch(status = 200, body: unknown = {}) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

// ---------------------------------------------------------------------------
// Guild configuration lookup
// ---------------------------------------------------------------------------

describe("guild-config lookup", () => {
  it("returns the enabled guild for a configured, enabled guild", () => {
    expect(getGuildConfig(GUILD_A)?.commanderRoleId).toBe(ROLE_A);
    expect(getGuildConfig(GUILD_A)?.commanderChannelId).toBe("1535955936269570048");
    expect(getGuildConfig(GUILD_B)?.commanderRoleId).toBe(ROLE_B);
  });

  it("each guild uses its own role id", () => {
    expect(getGuildConfig(GUILD_A)?.commanderRoleId).not.toBe(
      getGuildConfig(GUILD_B)?.commanderRoleId
    );
  });

  it("returns null for an unknown guild", () => {
    expect(getGuildConfig("999999999999999999")).toBeNull();
  });

  it("returns null for a disabled guild", () => {
    expect(getGuildConfig(GUILD_DISABLED)).toBeNull();
  });

  it("returns null for a missing guild id", () => {
    expect(getGuildConfig(undefined)).toBeNull();
  });

  it("isGuildDisabled is true only for a configured-and-disabled guild", () => {
    expect(isGuildDisabled(GUILD_DISABLED)).toBe(true);
    expect(isGuildDisabled(GUILD_A)).toBe(false);
    expect(isGuildDisabled("999999999999999999")).toBe(false);
    expect(isGuildDisabled(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Signature / interaction handling
// ---------------------------------------------------------------------------

describe("verifyDiscordRequest", () => {
  it("accepts a valid signature over timestamp + body", async () => {
    const raw = commanderInteraction();
    const { signature, timestamp } = await sign(raw);
    await expect(verifyDiscordRequest(publicKeyHex, raw, signature, timestamp)).resolves.toBe(true);
  });

  it("rejects a signature for a different body", async () => {
    const { signature, timestamp } = await sign("body-a");
    await expect(verifyDiscordRequest(publicKeyHex, "body-b", signature, timestamp)).resolves.toBe(
      false
    );
  });
});

describe("handleInteractions PING", () => {
  async function rawPing(): Promise<string> {
    return JSON.stringify({ type: 1 });
  }

  it("returns PONG for a valid signed PING", async () => {
    const env = makeEnv();
    const raw = await rawPing();
    const { status, body } = await signedPost(raw, env);
    expect(status).toBe(200);
    expect(body).toEqual({ type: 1 });
  });

  it("rejects a request with a missing signature", async () => {
    const env = makeEnv();
    const raw = JSON.stringify({ type: 1 });
    const response = await handleInteractions(
      new Request("https://discord.example/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw,
      }),
      env
    );
    expect(response.status).toBe(401);
  });

  it("rejects an invalid signature", async () => {
    const env = makeEnv();
    const raw = JSON.stringify({ type: 1 });
    const response = await handleInteractions(
      new Request("https://discord.example/interactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature-Ed25519": "0".repeat(128),
          "X-Signature-Timestamp": "1700000000",
        },
        body: raw,
      }),
      env
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Multi-guild authorization
// ---------------------------------------------------------------------------

describe("handleInteraction multi-guild authorization", () => {
  it("allows Guild A with Role A", () => {
    const interaction = JSON.parse(commanderInteraction()) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("create");
  });

  it("denies Guild A with the wrong role (Role B)", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: GUILD_A, member: { roles: [ROLE_B] } })
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("allows Guild B with Role B", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: GUILD_B, member: { roles: [ROLE_B] } })
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("create");
  });

  it("denies Guild B with the wrong role (Role A)", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: GUILD_B, member: { roles: [ROLE_A] } })
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("denies an unknown guild", () => {
    const interaction = JSON.parse(commanderInteraction({ guild_id: "99988112233" })) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("denies a disabled guild", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: GUILD_DISABLED, member: { roles: [ROLE_DISABLED] } })
    ) as unknown;
    const { decision, response } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
    expect((response as { data: { content: string } }).data.content).toContain("deaktiviert");
  });

  it("denies a DM / no guild context", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: undefined, member: undefined }) as string
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("denies missing member context", () => {
    const interaction = JSON.parse(
      commanderInteraction({ member: undefined }) as string
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("does not leak role or guild ids in deny messages", () => {
    const interaction = JSON.parse(commanderInteraction({ guild_id: "99988112233" })) as unknown;
    const { response } = handleInteraction(CONFIG, interaction);
    const content = (response as { data: { content: string } }).data.content;
    expect(content).not.toContain("99988112233");
    const disabled = JSON.parse(
      commanderInteraction({ guild_id: GUILD_DISABLED, member: { roles: [ROLE_DISABLED] } })
    ) as unknown;
    const disabledResponse = handleInteraction(CONFIG, disabled).response as {
      data: { content: string };
    };
    expect(disabledResponse.data.content).not.toContain(GUILD_DISABLED);
    expect(disabledResponse.data.content).not.toContain(ROLE_DISABLED);
  });
});

// ---------------------------------------------------------------------------
// Room creation via the interaction endpoint
// ---------------------------------------------------------------------------

describe("handleInteractions room creation", () => {
  it("creates exactly one Commander Link room for an authorized Guild A user", async () => {
    const api = mockApiFetch(201, {
      roomId: "bb63eaf988d4415e8f23413c4eeb5660",
      expiresAt: "2026-08-08T20:00:00.000Z",
      inviteUrl: "http://api.example/r/bb63eaf988d4415e8f23413c4eeb5660",
    });

    const env = makeEnv();
    const { status, body } = await signedPost(commanderInteraction(), env);

    expect(status).toBe(200);
    expect(body).toMatchObject({ type: 4 });
    expect(api).toHaveBeenCalledTimes(1);
    const [url, init] = api.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("http://api.example/v1/rooms");
    expect(init.headers.Authorization).toBe("Bearer it-is-a-secret");
  });

  it("publishes a browser URL and an HTTPS app launcher URL for the same room", async () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    const inviteUrl = `https://commander-link.joinoops.win/r/${roomId}`;
    mockApiFetch(201, {
      roomId,
      expiresAt: "2026-08-08T20:00:00.000Z",
      inviteUrl,
    });

    const env = makeEnv();
    const { status, body } = await signedPost(commanderInteraction(), env);

    expect(status).toBe(200);
    const content = (body as { data: { content: string } }).data.content;
    expect(content).toContain(inviteUrl);
    // App launcher should be an HTTPS URL, not a raw custom protocol
    const appLauncherUrl = `https://commander-link.joinoops.win/app/${roomId}`;
    expect(content).toContain(appLauncherUrl);
    // Should NOT contain the raw custom protocol
    expect(content).not.toContain("commanderlink://");
    // The room id appears in both links
    expect(content).toContain(roomId);
  });

  it("creates exactly one Commander Link room for an authorized Guild B user", async () => {
    const api = mockApiFetch(201, {
      roomId: "bb63eaf988d4415e8f23413c4eeb5660",
      expiresAt: "2026-08-08T20:00:00.000Z",
      inviteUrl: "http://api.example/r/bb63eaf988d4415e8f23413c4eeb5660",
    });

    const env = makeEnv();
    const raw = commanderInteraction({ guild_id: GUILD_B, member: { roles: [ROLE_B] } });
    const { status } = await signedPost(raw, env);

    expect(status).toBe(200);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("makes zero room-create requests for a wrong-role user", async () => {
    const api = mockApiFetch(201, {
      roomId: "bb63eaf988d4415e8f23413c4eeb5660",
      expiresAt: "2026-08-08T20:00:00.000Z",
      inviteUrl: "http://api.example/r/bb63eaf988d4415e8f23413c4eeb5660",
    });

    const env = makeEnv();
    const raw = commanderInteraction({ member: { roles: ["no-role"] } });
    const { status, body } = await signedPost(raw, env);

    expect(status).toBe(200);
    expect((body as { data: { content: string } }).data.content).toContain("Kommandeur");
    expect(api).toHaveBeenCalledTimes(0);
  });

  it("makes zero room-create requests for an unknown guild", async () => {
    const api = mockApiFetch(201, {});
    const env = makeEnv();
    const raw = commanderInteraction({ guild_id: "99988112233" });
    const { status, body } = await signedPost(raw, env);

    expect(status).toBe(200);
    expect((body as { data: { content: string } }).data.content).toContain("nicht freigeschaltet");
    expect(api).toHaveBeenCalledTimes(0);
  });

  it("makes zero room-create requests for a disabled guild", async () => {
    const api = mockApiFetch(201, {});
    const env = makeEnv();
    const raw = commanderInteraction({ guild_id: GUILD_DISABLED, member: { roles: [ROLE_DISABLED] } });
    const { status, body } = await signedPost(raw, env);

    expect(status).toBe(200);
    expect((body as { data: { content: string } }).data.content).toContain("deaktiviert");
    expect(api).toHaveBeenCalledTimes(0);
  });

  it("returns a friendly error when the Commander Link API fails", async () => {
    mockApiFetch(500, {});

    const env = makeEnv();
    const { status, body } = await signedPost(commanderInteraction(), env);

    expect(status).toBe(200);
    expect((body as { data: { content: string } }).data.content).toContain(
      "konnte gerade nicht erstellt"
    );
  });

  it("fails safely when the Commander Link response is malformed", async () => {
    mockApiFetch(201, { unexpected: true });

    const env = makeEnv();
    const { status, body } = await signedPost(commanderInteraction(), env);

    expect(status).toBe(200);
    expect((body as { data: { content: string } }).data.content).toContain(
      "konnte gerade nicht erstellt"
    );
  });
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("validateGuildConfig", () => {
  it("accepts a valid multi-guild config", () => {
    const config = validateGuildConfig({
      guilds: {
        [GUILD_A]: {
          name: "A",
          commanderRoleId: ROLE_A,
          commanderChannelId: "1535955936269570048",
          enabled: true,
        },
      },
    });
    expect(config.guilds[GUILD_A].commanderRoleId).toBe(ROLE_A);
    expect(config.guilds[GUILD_A].commanderChannelId).toBe("1535955936269570048");
  });

  it("rejects a malformed config (empty role)", () => {
    expect(() =>
      validateGuildConfig({
        guilds: { [GUILD_A]: { name: "A", commanderRoleId: "", enabled: true } },
      })
    ).toThrow(/guild configuration/i);
  });

  it("rejects a malformed config (enabled not boolean)", () => {
    expect(() =>
      validateGuildConfig({
        guilds: { [GUILD_A]: { name: "A", commanderRoleId: ROLE_A, enabled: "yes" } },
      })
    ).toThrow(/guild configuration/i);
  });

  it("rejects a config with a missing name", () => {
    expect(() =>
      validateGuildConfig({
        // @ts-expect-error intentionally missing name
        guilds: { [GUILD_A]: { commanderRoleId: ROLE_A, enabled: true } },
      })
    ).toThrow(/guild configuration/i);
  });

  it("rejects the wrong shape entirely", () => {
    expect(() => validateGuildConfig({ nope: true })).toThrow(/guild configuration/i);
  });
});

// ---------------------------------------------------------------------------
// Success response shape
// ---------------------------------------------------------------------------

describe("roomCreatedResponse", () => {
  it("embeds both the browser invite and an HTTPS app launcher for the same room", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    const inviteUrl = `https://commander-link.joinoops.win/r/${roomId}`;
    const response = roomCreatedResponse(inviteUrl, roomId);
    const data = response as { data: { content: string; flags: number; components: unknown[] } };
    expect(data.data.content).toContain("Commander-Link-Raum erstellt");
    expect(data.data.content).toContain("Im Browser öffnen");
    expect(data.data.content).toContain(inviteUrl);
    expect(data.data.content).toContain("In der Commander-Link-App öffnen");
    // Should use HTTPS app launcher, not raw custom protocol
    const appLauncherUrl = `https://commander-link.joinoops.win/app/${roomId}`;
    expect(data.data.content).toContain(appLauncherUrl);
    expect(data.data.content).not.toContain("commanderlink://");
    expect(data.data.flags).toBe(1 << 6); // ephemeral
    expect(data.data.components).toBeTruthy();
    
    // Verify browser, app and explicit share actions
    const components = data.data.components as Array<{
      type: number;
      components: Array<{ type: number; style: number; label: string; url?: string; custom_id?: string }>;
    }>;
    expect(components).toHaveLength(1);
    expect(components[0].components).toHaveLength(3);
    expect(components[0].components[0].label).toBe("Im Browser öffnen");
    expect(components[0].components[0].url).toBe(inviteUrl);
    expect(components[0].components[1].label).toBe("In der App öffnen");
    expect(components[0].components[1].url).toBe(appLauncherUrl);
    expect(components[0].components[2].label).toBe("An Commander senden");
    expect(components[0].components[2].custom_id).toContain(roomId);
  });

  it("shows the share button only when the current guild has a channel", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    const inviteUrl = `https://commander-link.joinoops.win/r/${roomId}`;
    const withChannel = roomCreatedResponse(inviteUrl, roomId, true) as {
      data: { components: Array<{ components: Array<{ label: string }> }> };
    };
    const withoutChannel = roomCreatedResponse(inviteUrl, roomId, false) as {
      data: { components: Array<{ components: Array<{ label: string }> }> };
    };
    expect(withChannel.data.components[0].components.map((button) => button.label)).toEqual([
      "Im Browser öffnen",
      "In der App öffnen",
      "An Commander senden",
    ]);
    expect(withoutChannel.data.components[0].components.map((button) => button.label)).toEqual([
      "Im Browser öffnen",
      "In der App öffnen",
    ]);
  });
});
