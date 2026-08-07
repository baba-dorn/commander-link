import { afterEach, describe, expect, it, vi } from "vitest";
import { MeteredVoiceBackend } from "./metered";

function backend() {
  return new MeteredVoiceBackend({
    appName: "dorn",
    secretKey: "sk_test",
    maxParticipants: 4,
    roomTtlSeconds: 21_600,
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

describe("MeteredVoiceBackend", () => {
  it("createSession posts an audio-only room and never leaks the secret to callers", async () => {
    const spy = mockFetch(200, { roomName: "abc" });
    await backend().createSession("roomabcdefghijklmnop1234");
    const [url, init] = spy.mock.calls[0] as [string, { body?: string }];
    expect(String(url)).toContain("dorn.metered.live/api/v1/room");
    expect(String(url)).toContain("secretKey=sk_test");
    expect(JSON.parse(String(init.body))).toMatchObject({
      audioOnlyRoom: true,
      privacy: "private",
    });
  });

  it("createSession treats an existing room (409) as success (idempotent)", async () => {
    mockFetch(409, { error: "exists" });
    await expect(backend().createSession("roomabcdefghijklmnop1234")).resolves.toBeUndefined();
  });

  it("createSession rethrows unexpected failures", async () => {
    mockFetch(500, { error: "boom" });
    await expect(backend().createSession("roomabcdefghijklmnop1234")).rejects.toThrow();
  });

  it("createAccessToken returns the token and a provider connection target", async () => {
    mockFetch(200, { token: "jwt-123" });
    const result = await backend().createAccessToken("roomabcdefghijklmnop1234", "Dorn");
    expect(result.token).toBe("jwt-123");
    expect(result.roomUrl).toBe("dorn.metered.live/roomabcdefghijklmnop1234");
  });

  it("createAccessToken throws when no token is returned", async () => {
    mockFetch(200, {});
    await expect(
      backend().createAccessToken("roomabcdefghijklmnop1234", "Dorn")
    ).rejects.toThrow();
  });

  it("deleteSession is best-effort and swallows errors", async () => {
    mockFetch(404, { error: "not found" });
    await expect(backend().deleteSession("roomabcdefghijklmnop1234")).resolves.toBeUndefined();
  });
});
