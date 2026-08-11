import { LEASE_IDLE_MS, pruneLeases, type AdmissionLease } from "@commander-link/core";

/** A used room is removed five minutes after its last real activity. */
export const ROOM_EMPTY_GRACE_MS = 5 * 60 * 1000;

export interface LifecycleRoom {
  expiresAt: number;
  everOccupied: boolean;
  emptySince: number | null;
}

export interface LifecycleDecision {
  activeLeases: AdmissionLease[];
  participantsExpired: number;
  lastActivityAt: number | null;
  emptySince: number | null;
  deleteRoom: boolean;
  nextAlarmAt: number | null;
}

function latestActivity(leases: AdmissionLease[]): number | null {
  if (leases.length === 0) return null;
  return Math.max(...leases.map((lease) => lease.lastSeen));
}

/**
 * Resolve the room lifecycle from one serialized Durable Object snapshot.
 * Expired leases contribute their last heartbeat to the empty-grace clock;
 * they do not cause a second grace period after being pruned.
 */
export function evaluateLifecycle(
  room: LifecycleRoom,
  leases: AdmissionLease[],
  now: number,
): LifecycleDecision {
  const activeLeases = pruneLeases(leases, now);
  const lastActivityAt = latestActivity(leases);
  const emptySince = activeLeases.length > 0
    ? null
    : room.emptySince ?? (room.everOccupied ? lastActivityAt ?? now : null);
  const expired = now >= room.expiresAt;
  const emptyGraceElapsed = emptySince !== null && now >= emptySince + ROOM_EMPTY_GRACE_MS;
  const deleteRoom = expired || emptyGraceElapsed;

  if (deleteRoom) {
    return {
      activeLeases,
      participantsExpired: leases.length - activeLeases.length,
      lastActivityAt,
      emptySince,
      deleteRoom: true,
      nextAlarmAt: null,
    };
  }

  const heartbeatExpiry = activeLeases.length > 0
    ? Math.min(...activeLeases.map((lease) => lease.lastSeen + LEASE_IDLE_MS))
    : Number.POSITIVE_INFINITY;
  const emptyGraceExpiry = emptySince === null
    ? Number.POSITIVE_INFINITY
    : emptySince + ROOM_EMPTY_GRACE_MS;

  return {
    activeLeases,
    participantsExpired: leases.length - activeLeases.length,
    lastActivityAt,
    emptySince,
    deleteRoom: false,
    nextAlarmAt: Math.min(room.expiresAt, heartbeatExpiry, emptyGraceExpiry),
  };
}
