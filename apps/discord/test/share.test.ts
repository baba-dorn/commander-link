import { afterEach, describe, expect, it, vi } from "vitest";
import { shareRoom, ShareError } from "../src/share";
import { cleanupExpiredInvitations } from "../src/share";

const roomId = "bb63eaf988d4415e8f23413c4eeb566";
const missingRoomId = "cc74fba999e5526f9a34524d5ffc6771";
class MapKv {
  private values = new Map<string, string>();
  clear() { this.values.clear(); }
  async get(key: string, type?: "json") { const value = this.values.get(key); return type === "json" ? (value ? JSON.parse(value) : null) : value ?? null; }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
  async list({ prefix }: { prefix?: string }) { return { keys: [...this.values.keys()].filter((key) => !prefix || key.startsWith(prefix)).map((name) => ({ name })), list_complete: true } as KVNamespaceListResult<unknown>; }
}

const tracking = new MapKv() as unknown as KVNamespace;
const env = {
  commanderLinkApiUrl: "https://api.example",
  commanderLinkWebUrl: "https://commander-link.example",
  guildId: "987654321098765432",
  commanderChannelId: "123456789012345678",
  discordBotToken: "bot-secret",
  invitationTracking: tracking,
};

afterEach(() => { vi.unstubAllGlobals(); (tracking as unknown as MapKv).clear(); });

describe("shareRoom", () => {
  it("verifies the existing room and posts both links to the configured channel", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        roomId, exists: true, expiresAt: "2026-08-10T20:00:00.000Z", maxPeers: 4, peerCount: 0,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "message-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(shareRoom(roomId, "Baba", env)).resolves.toBe("shared");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://discord.com/api/v10/channels/${env.commanderChannelId}/messages`);
    expect(init.headers).toMatchObject({
      Authorization: "Bot bot-secret",
      "Content-Type": "application/json",
    });
    const posted = JSON.parse(String(init.body)) as { content: string; components: Array<{ components: Array<{ label: string; url?: string }> }> };
    expect(posted.content).toContain(`\`\`\`\n${env.commanderLinkWebUrl}/r/${roomId}\n\`\`\``);
    expect(posted.content).not.toContain(`${env.commanderLinkWebUrl}/app/${roomId}`);
    expect(posted.content).not.toContain("commanderlink://");
    expect(posted.components[0].components).toEqual([
      { type: 2, style: 5, label: "In der App öffnen", url: `${env.commanderLinkWebUrl}/app/${roomId}` },
      { type: 2, style: 5, label: "Im Browser öffnen", url: `${env.commanderLinkWebUrl}/r/${roomId}` },
    ]);
    await expect(env.invitationTracking.get(`invitation:${roomId}`, "json")).resolves.toMatchObject({ roomId, messageId: "message-1" });
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

  it("keeps an active room and does not delete its invitation", async () => {
    const room = "dd85afbaaab6637fa6b45635e6ee7882";
    await tracking.put(`invitation:${room}`, JSON.stringify({ roomId: room, channelId: "channel-1", messageId: "message-active", createdAt: new Date().toISOString() }));
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ roomId: room, exists: true, expiresAt: "2026-08-10T20:00:00.000Z", maxPeers: 4, peerCount: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    await cleanupExpiredInvitations({ commanderLinkApiUrl: env.commanderLinkApiUrl, discordBotToken: env.discordBotToken, invitationTracking: tracking });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(tracking.get(`invitation:${room}`, "json")).resolves.toBeTruthy();
  });

  it("deletes an expired invitation and its tracking record", async () => {
    const room = "ee96bgbbbb7748e7b7c56746f7ff8993";
    await tracking.put(`invitation:${room}`, JSON.stringify({ roomId: room, channelId: "channel-2", messageId: "message-expired", createdAt: new Date().toISOString() }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ roomId: room, exists: false, expiresAt: null, maxPeers: 4, peerCount: 0 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await cleanupExpiredInvitations({ commanderLinkApiUrl: env.commanderLinkApiUrl, discordBotToken: env.discordBotToken, invitationTracking: tracking });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("DELETE");
    await expect(tracking.get(`invitation:${room}`, "json")).resolves.toBeNull();
  });

  it("retains tracking when the API or Discord temporarily fails", async () => {
    const apiRoom = "ff07chcccc8859f8c8d67857f8ffa9a4";
    const discordRoom = "aa18didddd996a9d9e78968a9aabb5b5";
    await tracking.put(`invitation:${apiRoom}`, JSON.stringify({ roomId: apiRoom, channelId: "channel-3", messageId: "message-api", createdAt: new Date().toISOString() }));
    await tracking.put(`invitation:${discordRoom}`, JSON.stringify({ roomId: discordRoom, channelId: "channel-4", messageId: "message-discord", createdAt: new Date().toISOString() }));
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ roomId: discordRoom, exists: false, expiresAt: null, maxPeers: 4, peerCount: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 50013, message: "Missing Permissions" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await cleanupExpiredInvitations({ commanderLinkApiUrl: env.commanderLinkApiUrl, discordBotToken: env.discordBotToken, invitationTracking: tracking });
    await expect(tracking.get(`invitation:${apiRoom}`, "json")).resolves.toBeTruthy();
    await expect(tracking.get(`invitation:${discordRoom}`, "json")).resolves.toBeTruthy();
  });

  it("treats an already absent Discord message as cleaned up", async () => {
    const room = "bb29ejeeeeaa6ba0a0f89a79babcc6c6";
    await tracking.put(`invitation:${room}`, JSON.stringify({ roomId: room, channelId: "channel-5", messageId: "message-gone", createdAt: new Date().toISOString() }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ roomId: room, exists: false, expiresAt: null, maxPeers: 4, peerCount: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 10008, message: "Unknown Message" }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await cleanupExpiredInvitations({ commanderLinkApiUrl: env.commanderLinkApiUrl, discordBotToken: env.discordBotToken, invitationTracking: tracking });
    await expect(tracking.get(`invitation:${room}`, "json")).resolves.toBeNull();
  });
});
