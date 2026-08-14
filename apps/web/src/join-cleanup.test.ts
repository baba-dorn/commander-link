import { describe, expect, it } from "vitest";
import type { JoinRoomResponse } from "@commander-link/core";
import { cleanupFailedJoin } from "./join-cleanup";

const session = {
  roomId: "bb63eaf988d4415e8f23413c4eeb566",
  peerId: "peer-1",
  realtimeToken: "token",
  channel: "commander-link/bb63eaf988d4415e8f23413c4eeb566",
  admissionId: "11111111-1111-4111-8111-111111111111",
  expiresAt: "2026-08-14T12:00:00.000Z",
} satisfies JoinRoomResponse;

describe("cleanupFailedJoin", () => {
  it("releases the admission after transport cleanup", async () => {
    const calls: string[] = [];
    const connection = { disconnect: async () => { calls.push("disconnect"); } } as never;
    const release = async (roomId: string, admissionId: string) => {
      calls.push(`release:${roomId}:${admissionId}`);
    };

    await cleanupFailedJoin(session.roomId, session, connection, release);

    expect(calls).toEqual([
      "disconnect",
      `release:${session.roomId}:${session.admissionId}`,
    ]);
  });

  it("still releases the admission when transport cleanup throws", async () => {
    let released = false;
    const connection = {
      disconnect: async () => { throw new Error("close failed"); },
    } as never;
    const release = async () => { released = true; };

    await cleanupFailedJoin(session.roomId, session, connection, release);

    expect(released).toBe(true);
  });

  it("does not release a lease when admission never succeeded", async () => {
    let released = false;
    const connection = { disconnect: async () => {} } as never;
    const release = async () => { released = true; };

    await cleanupFailedJoin(session.roomId, null, connection, release);

    expect(released).toBe(false);
  });
});
