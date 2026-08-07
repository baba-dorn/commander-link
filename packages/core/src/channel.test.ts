import { describe, expect, it } from "vitest";
import {
  channelForRoom,
  JoinRoomResponseSchema,
  REALTIME_CHANNEL_PREFIX,
  type JoinRoomResponse,
} from "./index";

describe("channelForRoom", () => {
  it("is deterministic and namespaced", () => {
    const room = "bb63eaf988d4415e8f23413c4eeb566";
    expect(channelForRoom(room)).toBe(`commander-link/${room}`);
    expect(channelForRoom(room)).toBe(channelForRoom(room));
  });

  it("maps distinct rooms to distinct channels", () => {
    const a = channelForRoom("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const b = channelForRoom("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("does not collide with Metered reserved channel prefixes", () => {
    const channel = channelForRoom("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(channel.startsWith("_metered/")).toBe(false);
    expect(channel.startsWith("_internal/")).toBe(false);
    expect(channel.startsWith("_system/")).toBe(false);
  });

  it("matches the documented prefix constant", () => {
    expect(channelForRoom("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").startsWith(`${REALTIME_CHANNEL_PREFIX}/`)).toBe(
      true
    );
  });
});

describe("JoinRoomResponseSchema", () => {
  const valid: JoinRoomResponse = {
    roomId: "bb63eaf988d4415e8f23413c4eeb566",
    peerId: "9f3ab2c1",
    realtimeToken: "eyJhbGciOiJIUzI1NiJ9.some.payload",
    channel: "commander-link/bb63eaf988d4415e8f23413c4eeb566",
    admissionId: "6f2c1d0e-3b4a-5c6d-8e8f-9a0b1c2d3e4f",
    expiresAt: "2026-08-07T18:00:00.000Z",
  };

  it("accepts the Realtime join response contract", () => {
    expect(JoinRoomResponseSchema.parse(valid)).toEqual(valid);
  });

  it("requires a realtimeToken and channel", () => {
    const { realtimeToken: _omitToken, ...noToken } = valid;
    expect(JoinRoomResponseSchema.safeParse(noToken).success).toBe(false);

    const { channel: _omitChannel, ...noChannel } = valid;
    expect(JoinRoomResponseSchema.safeParse(noChannel).success).toBe(false);
  });

  it("rejects the old Metered Video roomUrl/token contract", () => {
    const oldStyle = {
      roomId: valid.roomId,
      peerId: valid.peerId,
      token: "old-video-token",
      roomUrl: "dorn.metered.live/bb63eaf988d4415e8f23413c4eeb566",
      tokenExpiresAt: "2026-08-07T18:00:00.000Z",
      admissionId: valid.admissionId,
    };
    expect(JoinRoomResponseSchema.safeParse(oldStyle).success).toBe(false);
  });
});
