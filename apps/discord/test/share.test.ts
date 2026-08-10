import { afterEach, describe, expect, it, vi } from "vitest";
import { shareRoom, ShareError } from "../src/share";

const roomId = "bb63eaf988d4415e8f23413c4eeb566";
const missingRoomId = "cc74fba999e5526f9a34524d5ffc6771";
const env = {
  commanderLinkApiUrl: "https://api.example",
  commanderLinkWebUrl: "https://commander-link.example",
  commanderChannelId: "123456789012345678",
  discordBotToken: "bot-secret",
};

afterEach(() => vi.unstubAllGlobals());

describe("shareRoom", () => {
  it("verifies the existing room and posts both links to the configured channel", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        roomId, exists: true, expiresAt: "2026-08-10T20:00:00.000Z", maxPeers: 4, peerCount: 0,
      })))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareRoom(roomId, "Baba", env)).resolves.toBe("shared");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://discord.com/api/v10/channels/${env.commanderChannelId}/messages`);
    expect(init.headers).toMatchObject({ Authorization: "Bot bot-secret" });
    expect(String(init.body)).toContain(`${env.commanderLinkWebUrl}/r/${roomId}`);
    expect(String(init.body)).toContain(`${env.commanderLinkWebUrl}/app/${roomId}`);
  });

  it("fails before publishing when the room does not exist", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        roomId: missingRoomId, exists: false, expiresAt: null, maxPeers: 4, peerCount: 0,
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareRoom(missingRoomId, undefined, env)).rejects.toBeInstanceOf(ShareError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects missing sharing configuration without a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(shareRoom(roomId, undefined, { commanderLinkApiUrl: env.commanderLinkApiUrl }))
      .rejects.toBeInstanceOf(ShareError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
