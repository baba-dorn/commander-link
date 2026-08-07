import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceBackend } from "./index";
import { MeteredRealtimeVoiceBackend } from "./metered";

function backend() {
  return new MeteredRealtimeVoiceBackend({
    keyId: "sk_id_test",
    secretKey: "sk_secret_test",
    tokenTtlSeconds: 3_600,
  });
}

function mockFetch(status: number, body: unknown = {}) {
  const spy = vi.fn((..._args: unknown[]) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROOM_ID = "bb63eaf988d4415e8f23413c4eeb566";

describe("MeteredRealtimeVoiceBackend.createAccessToken", () => {
  it("mints via the Realtime tokens endpoint with key-pair Bearer auth and exact channel scope", async () => {
    const spy = mockFetch(200, { token: "jwt-123", expiresAt: 1_752_000_000 });
    const result = await backend().createAccessToken(ROOM_ID, "peer-1", "Dorn");

    const [url, init] = spy.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(String(url)).toBe("https://rms.metered.ca/v1/tokens");
    expect(init.headers.Authorization).toBe("Bearer sk_id_test:sk_secret_test");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      peerId: "peer-1",
      channels: [`commander-link/${ROOM_ID}`],
      permissions: ["publish", "subscribe", "presence", "send"],
      expiresInSec: 3_600,
      peerMetadata: { username: "Dorn" },
    });

    expect(result).toEqual({
      token: "jwt-123",
      channel: `commander-link/${ROOM_ID}`,
      expiresAt: 1_752_000_000,
    });
  });

  it("never includes the secret key pair in the request body", async () => {
    const spy = mockFetch(200, { token: "jwt-123", expiresAt: 1_752_000_000 });
    await backend().createAccessToken(ROOM_ID, "peer-1", "Dorn");
    const [, init] = spy.mock.calls[0] as [string, { body: string }];
    expect(init.body).not.toContain("sk_id_test");
    expect(init.body).not.toContain("sk_secret_test");
  });

  it("does not call any Video Room provisioning or deletion endpoint", async () => {
    const spy = mockFetch(200, { token: "jwt-123", expiresAt: 1_752_000_000 });
    await backend().createAccessToken(ROOM_ID, "peer-1", "Dorn");
    const [url] = spy.mock.calls[0] as [string];
    expect(String(url)).not.toMatch(/\/api\/v1\/room/);
    expect(String(url)).not.toMatch(/roomName=/);
  });

  it("throws when no token is returned", async () => {
    mockFetch(200, { expiresAt: 1_752_000_000 });
    await expect(backend().createAccessToken(ROOM_ID, "peer-1", "Dorn")).rejects.toThrow();
  });

  it("throws when no expiry is returned", async () => {
    mockFetch(200, { token: "jwt-123" });
    await expect(backend().createAccessToken(ROOM_ID, "peer-1", "Dorn")).rejects.toThrow();
  });

  it("throws on provider errors", async () => {
    mockFetch(401, { error: "unauthorized" });
    await expect(backend().createAccessToken(ROOM_ID, "peer-1", "Dorn")).rejects.toThrow();
  });

  it("surfaces the provider's machine-readable error code safely", async () => {
    mockFetch(403, { error: "channel_not_authorized" });
    await expect(backend().createAccessToken(ROOM_ID, "peer-1", "Dorn")).rejects.toMatchObject({
      name: "VoiceBackendError",
      code: "channel_not_authorized",
    });
  });

  it("reports unreachable provider as a VoiceBackendError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("DNS failure")))
    );
    await expect(backend().createAccessToken(ROOM_ID, "peer-1", "Dorn")).rejects.toMatchObject({
      name: "VoiceBackendError",
      code: "provider_unreachable",
    });
  });
});

describe("createVoiceBackend (no Video room provisioning surface)", () => {
  it("exposes only token minting — no createSession/deleteSession", () => {
    const backendImpl = createVoiceBackend({
      METERED_REALTIME_KEY_ID: "sk_id_test",
      METERED_REALTIME_SECRET: "sk_secret_test",
      TOKEN_TTL_SECONDS: "3600",
    });
    expect(backendImpl).toBeInstanceOf(MeteredRealtimeVoiceBackend);
    expect(typeof backendImpl.createAccessToken).toBe("function");
    expect(
      "createSession" in backendImpl || "deleteSession" in backendImpl
    ).toBe(false);
  });
});
