import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleInteraction,
  roomCreatedResponse,
  verifyDiscordRequest,
  type DiscordConfig,
} from "../src/discord";
import { handleInteractions, type Env } from "../src/index";

const GUILD_ID = "111111111111111111";
const ROLE_ID = "222222222222222222";

const CONFIG: DiscordConfig = {
  publicKey: "placeholder-hex",
  applicationId: "999999999999999999",
  guildId: GUILD_ID,
  commanderRoleId: ROLE_ID,
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
  const message = new TextEncoder().encode(`${timestamp}\n${raw}`);
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", secretKey, message));
  return { signature: bytesToHex(sig), timestamp };
}

function commanderInteraction(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 2,
    data: { name: "commander" },
    guild_id: GUILD_ID,
    member: { roles: [ROLE_ID] },
    ...overrides,
  });
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_APPLICATION_ID: "999999999999999999",
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_COMMANDER_ROLE_ID: ROLE_ID,
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
// Authorization
// ---------------------------------------------------------------------------

describe("handleInteraction authorization", () => {
  it("allows the correct guild + Commander role", () => {
    const interaction = JSON.parse(commanderInteraction()) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("create");
  });

  it("denies the correct guild without the Commander role", () => {
    const interaction = JSON.parse(commanderInteraction({ member: { roles: ["some-other"] } })) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("denies the wrong guild", () => {
    const interaction = JSON.parse(commanderInteraction({ guild_id: "99988112233" })) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });

  it("denies a DM / no guild context", () => {
    const interaction = JSON.parse(
      commanderInteraction({ guild_id: undefined, member: undefined }) as string
    ) as unknown;
    const { decision } = handleInteraction(CONFIG, interaction);
    expect(decision).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Room creation via the interaction endpoint
// ---------------------------------------------------------------------------

describe("handleInteractions room creation", () => {
  it("creates exactly one Commander Link room for an authorized user", async () => {
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

  it("makes zero room-create requests for an unauthorized user", async () => {
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
// Success response shape
// ---------------------------------------------------------------------------

describe("roomCreatedResponse", () => {
  it("embeds the invite as content and a URL button", () => {
    const response = roomCreatedResponse("http://api.example/r/xyz");
    const data = response as { data: { content: string; flags: number; components: unknown[] } };
    expect(data.data.content).toContain("Commander-Link-Raum erstellt");
    expect(data.data.flags).toBe(1 << 6); // ephemeral
    expect(data.data.components).toBeTruthy();
  });
});
