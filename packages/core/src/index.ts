import { z } from "zod";

/**
 * Shared contracts and the fail-closed push-to-talk state machine.
 * This package is imported by the Worker, the web renderer and the Electron shell,
 * so it must stay free of any runtime-specific (DOM / Node / Workers) imports.
 */

// A server-issued room id. We mint lowercase hex ids so the same value is a valid
// Metered room name (`[a-z0-9-]`) and satisfies this schema without transformation.
export const RoomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);
export type RoomId = z.infer<typeof RoomIdSchema>;

/**
 * Extract a validated room id from any accepted user input: a raw room id, an
 * HTTPS invite (`.../r/<id>`) or a deep link (`commanderlink://join/<id>`).
 * Returns `null` when no valid room id is present. Shared by the browser join
 * field and mirrors the desktop deep-link parsing rules.
 */
export function extractRoomId(input: string): RoomId | null {
  const raw = input.trim();
  if (!raw) return null;

  const direct = RoomIdSchema.safeParse(raw);
  if (direct.success) return direct.data;

  let candidate = "";
  try {
    const url = new URL(raw);
    if (url.protocol === "commanderlink:") {
      // commanderlink://join/<id>  -> host "join", pathname "/<id>"
      candidate = url.pathname.replace(/^\/+/, "") || url.searchParams.get("room") || "";
    } else if (url.protocol === "http:" || url.protocol === "https:") {
      const match = url.pathname.match(/\/r\/([^/]+)/);
      candidate = match ? match[1] : "";
    }
  } catch {
    // Not a URL; fall back to substring extraction below.
    const match = raw.match(/(?:\/r\/|join\/)([A-Za-z0-9_-]{20,128})/);
    candidate = match ? match[1] : "";
  }

  const parsed = RoomIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export const DisplayNameSchema = z.string().trim().min(1).max(48);

export const CreateRoomResponseSchema = z.object({
  roomId: RoomIdSchema,
  expiresAt: z.string().datetime(),
  inviteUrl: z.string().url(),
});
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;

export const RoomMetadataSchema = z.object({
  roomId: RoomIdSchema,
  exists: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  maxPeers: z.number().int().positive(),
  peerCount: z.number().int().nonnegative(),
});
export type RoomMetadata = z.infer<typeof RoomMetadataSchema>;

export const JoinRoomRequestSchema = z.object({
  displayName: DisplayNameSchema,
  admissionId: z.string().uuid().optional(),
});
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;

export const JoinRoomResponseSchema = z.object({
  roomId: RoomIdSchema,
  // Commander Link participant id; becomes the Metered Realtime JWT `sub` claim.
  peerId: z.string().min(1).max(128),
  // Short-lived, channel-scoped Metered Realtime JWT. Never a secret/master key.
  realtimeToken: z.string().min(1),
  // The deterministic Realtime channel for this room (see channelForRoom).
  channel: z.string().min(1).max(200),
  admissionId: z.string().uuid(),
  // ISO-8601 expiry of the realtime token.
  expiresAt: z.string().datetime(),
});
export type JoinRoomResponse = z.infer<typeof JoinRoomResponseSchema>;

// ---------------------------------------------------------------------------
// Realtime channel naming
// ---------------------------------------------------------------------------

// A Commander Link room maps to exactly one Metered Realtime channel. The name
// is deterministic so every peer of the same room joins the same channel. It
// avoids Metered's reserved prefixes (`_metered/`, `_internal/`, `_system/`)
// and uses the slash-separated form documented by the Realtime SDK.
export const REALTIME_CHANNEL_PREFIX = "commander-link";

export function channelForRoom(roomId: RoomId): string {
  return `${REALTIME_CHANNEL_PREFIX}/${roomId}`;
}

/**
 * The desktop custom-protocol scheme used for the installed Electron app. A
 * deep link always resolves to the same Commander Link room as its HTTPS
 * invite (`<origin>/r/<roomId>`); only the launch method differs.
 */
export const DEEP_LINK_PROTOCOL = "commanderlink";

/** Build the Electron deep link for a room, e.g. `commanderlink://join/<roomId>`. */
export function deepLinkForRoom(roomId: RoomId): string {
  return `${DEEP_LINK_PROTOCOL}://join/${roomId}`;
}

export const LeaveRoomRequestSchema = z.object({
  admissionId: z.string().uuid(),
});
export type LeaveRoomRequest = z.infer<typeof LeaveRoomRequestSchema>;

// ---------------------------------------------------------------------------
// Admission leases (pure, so the 4-peer limit is unit-testable without the
// Workers runtime; the Durable Object only supplies storage + serialization).
// ---------------------------------------------------------------------------

export interface AdmissionLease {
  admissionId: string;
  peerId: string;
  displayName: string;
  joinedAt: number;
  lastSeen: number;
}

// Abandoned leases are reclaimed after this idle window so a crashed browser tab
// cannot permanently occupy one of the four slots.
export const LEASE_IDLE_MS = 5 * 60 * 1000;

export function pruneLeases(leases: AdmissionLease[], now: number): AdmissionLease[] {
  const cutoff = now - LEASE_IDLE_MS;
  return leases.filter((lease) => lease.lastSeen >= cutoff);
}

export type AdmissionReason = "full";

export type AdmissionDecision =
  | { ok: true; leases: AdmissionLease[]; lease: AdmissionLease; reused: boolean }
  | { ok: false; reason: AdmissionReason };

/**
 * Decide whether a join is admitted, operating on the already-pruned lease list.
 * A known `admissionId` refreshes its lease without consuming a new slot (reconnect).
 */
export function decideAdmission(params: {
  leases: AdmissionLease[];
  maxPeers: number;
  now: number;
  displayName: string;
  admissionId?: string;
  newAdmissionId: string;
  newPeerId: string;
}): AdmissionDecision {
  const { leases, maxPeers, now, displayName, admissionId, newAdmissionId, newPeerId } = params;

  if (admissionId) {
    const existing = leases.find((lease) => lease.admissionId === admissionId);
    if (existing) {
      const refreshed: AdmissionLease = { ...existing, lastSeen: now };
      return {
        ok: true,
        reused: true,
        lease: refreshed,
        leases: leases.map((lease) => (lease.admissionId === admissionId ? refreshed : lease)),
      };
    }
  }

  if (leases.length >= maxPeers) return { ok: false, reason: "full" };

  const lease: AdmissionLease = {
    admissionId: newAdmissionId,
    peerId: newPeerId,
    displayName,
    joinedAt: now,
    lastSeen: now,
  };
  return { ok: true, reused: false, lease, leases: [...leases, lease] };
}

// ---------------------------------------------------------------------------
// Push-to-talk state machine
// ---------------------------------------------------------------------------

export type PttState = "muted" | "transmitting" | "blocked" | "disconnected";
export type PttEvent =
  | "press"
  | "release"
  | "blur"
  | "hidden"
  | "disconnect"
  | "reconnect"
  | "error";

/**
 * Pure reducer. The only path into `transmitting` is an explicit press while muted.
 * Every failure/ambiguity path (`release`, `blur`, `hidden`, `error`, `disconnect`,
 * `reconnect`) resolves to a non-transmitting state, so transmission always fails closed.
 */
export function reducePtt(state: PttState, event: PttEvent): PttState {
  switch (event) {
    case "disconnect":
      return "disconnected";
    case "error":
      return "blocked";
    case "reconnect":
      return "muted";
    case "release":
    case "blur":
    case "hidden":
      return "muted";
    case "press":
      return state === "muted" ? "transmitting" : state;
    default:
      return state;
  }
}

export type PttListener = (state: PttState, previous: PttState) => void;

/**
 * Thin observable wrapper around {@link reducePtt}. The web button and the Electron
 * global hotkey both drive the exact same controller semantics.
 */
export class PttController {
  private current: PttState;
  private readonly listeners = new Set<PttListener>();

  constructor(initial: PttState = "muted") {
    this.current = initial;
  }

  get state(): PttState {
    return this.current;
  }

  get transmitting(): boolean {
    return this.current === "transmitting";
  }

  on(listener: PttListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(event: PttEvent): PttState {
    const previous = this.current;
    const next = reducePtt(previous, event);
    if (next !== previous) {
      this.current = next;
      for (const listener of this.listeners) listener(next, previous);
    }
    return next;
  }

  press(): PttState {
    return this.dispatch("press");
  }
  release(): PttState {
    return this.dispatch("release");
  }
  blur(): PttState {
    return this.dispatch("blur");
  }
  hidden(): PttState {
    return this.dispatch("hidden");
  }
  disconnect(): PttState {
    return this.dispatch("disconnect");
  }
  reconnect(): PttState {
    return this.dispatch("reconnect");
  }
  error(): PttState {
    return this.dispatch("error");
  }
}
