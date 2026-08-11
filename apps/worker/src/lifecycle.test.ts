import { describe, expect, it } from "vitest";
import { LEASE_IDLE_MS, type AdmissionLease } from "@commander-link/core";
import { evaluateLifecycle, ROOM_EMPTY_GRACE_MS } from "./lifecycle";

const NOW = 1_800_000_000_000;
const room = (emptySince: number | null = null) => ({
  expiresAt: NOW + 60 * 60 * 1000,
  everOccupied: true,
  emptySince,
});
const lease = (lastSeen: number, admissionId = String(lastSeen)): AdmissionLease => ({
  admissionId,
  peerId: `peer-${admissionId}`,
  displayName: "Test",
  joinedAt: lastSeen,
  lastSeen,
});

describe("room lifecycle", () => {
  it("starts clean-leave grace immediately", () => {
    const result = evaluateLifecycle(room(NOW), [], NOW + ROOM_EMPTY_GRACE_MS - 1);
    expect(result.deleteRoom).toBe(false);
    expect(result.nextAlarmAt).toBe(NOW + ROOM_EMPTY_GRACE_MS);
    expect(evaluateLifecycle(room(NOW), [], NOW + ROOM_EMPTY_GRACE_MS).deleteRoom).toBe(true);
  });

  it("does not add another five minutes after heartbeat expiry", () => {
    const lastSeen = NOW;
    const atExpiry = lastSeen + LEASE_IDLE_MS;
    const result = evaluateLifecycle(room(), [lease(lastSeen)], atExpiry);
    expect(result.activeLeases).toHaveLength(0);
    expect(result.emptySince).toBe(lastSeen);
    expect(result.deleteRoom).toBe(true);
  });

  it("uses the last heartbeat when several participants expire at different times", () => {
    const lastSeenA = NOW;
    const lastSeenB = NOW + 2 * 60 * 1000;
    const atBExpiry = lastSeenB + LEASE_IDLE_MS;
    const result = evaluateLifecycle(room(), [lease(lastSeenA, "a"), lease(lastSeenB, "b")], atBExpiry - 1);
    expect(result.activeLeases).toHaveLength(1);
    expect(result.activeLeases[0].admissionId).toBe("b");
    expect(result.nextAlarmAt).toBe(atBExpiry);
    const afterBGrace = evaluateLifecycle(room(), [lease(lastSeenA, "a"), lease(lastSeenB, "b")], lastSeenB + LEASE_IDLE_MS + ROOM_EMPTY_GRACE_MS);
    expect(afterBGrace.deleteRoom).toBe(true);
  });

  it("lets a reconnect cancel the pending empty cleanup", () => {
    const reconnect = evaluateLifecycle(room(NOW), [lease(NOW + ROOM_EMPTY_GRACE_MS - 1)], NOW + ROOM_EMPTY_GRACE_MS - 1);
    expect(reconnect.activeLeases).toHaveLength(1);
    expect(reconnect.emptySince).toBeNull();
    expect(reconnect.deleteRoom).toBe(false);
  });

  it("is idempotent once the cleanup deadline has passed", () => {
    const result = evaluateLifecycle(room(NOW), [], NOW + ROOM_EMPTY_GRACE_MS);
    expect(evaluateLifecycle(room(result.emptySince), [], NOW + ROOM_EMPTY_GRACE_MS).deleteRoom).toBe(true);
  });
});
