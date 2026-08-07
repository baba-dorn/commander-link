// Pure participant roster logic for the transport. Keeping this free of DOM and
// SDK types makes the peer-join / peer-left mapping unit-testable.

export interface RosterEntry {
  id: string;
  name: string;
}

export interface RosterViewEntry {
  id: string;
  name: string;
  volume: number;
}

/**
 * Record a remote peer as present. Insertion order is preserved (join order).
 */
export function applyPeerJoined(
  roster: RosterEntry[],
  entry: RosterEntry
): RosterEntry[] {
  if (roster.some((e) => e.id === entry.id)) {
    return roster.map((e) => (e.id === entry.id ? { ...e, name: entry.name } : e));
  }
  return [...roster, entry];
}

/**
 * Drop a remote peer (peer-left). Removing by id keeps the roster clean even if
 * a stream-removed raced ahead of the presence event.
 */
export function applyPeerLeft(roster: RosterEntry[], peerId: string): RosterEntry[] {
  return roster.filter((e) => e.id !== peerId);
}

/** Build the UI-facing peer list from the roster and per-peer volumes. */
export function toPeerViews(
  roster: RosterEntry[],
  volumes: Map<string, number> | ReadonlyMap<string, number>
): RosterViewEntry[] {
  return roster.map((e) => ({ id: e.id, name: e.name, volume: volumes.get(e.id) ?? 1 }));
}

/** Safely read a display name out of JWT `peerMetadata` (untrusted shape). */
export function nameFromMetadata(metadata: Record<string, unknown> | undefined): string {
  if (metadata && typeof metadata.username === "string" && metadata.username.length > 0) {
    return metadata.username;
  }
  return "";
}
