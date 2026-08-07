import { DurableObject } from "cloudflare:workers";
import {
  CreateRoomResponseSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  RoomIdSchema,
  decideAdmission,
  pruneLeases,
  type AdmissionLease,
  type RoomMetadata,
} from "@commander-link/core";
import { createVoiceBackend } from "./voice";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomGate>;
  // Voice backend configuration — consumed only by the VoiceBackend implementation.
  METERED_APP_NAME: string;
  // Wrangler secret. Server-side only — never returned to any client.
  METERED_SECRET_KEY: string;
  APP_ORIGIN: string;
  ROOM_TTL_SECONDS: string;
  TOKEN_TTL_SECONDS: string;
  MAX_ROOM_PEERS: string;
}

interface RoomRecord {
  createdAt: number;
  expiresAt: number;
  roomId: string;
  // Whether the voice backend session has been provisioned (lazy, on first join).
  provisioned: boolean;
  // When the room became empty (last participant left); null while occupied.
  emptySince: number | null;
}

// Keep an empty room briefly so a quick reconnect does not lose the session.
const GRACE_MS = 5 * 60 * 1000;
// Periodic safety net: prune dead heartbeats and clean up orphaned/expired rooms.
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

export type AdmitResult =
  | { ok: true; peerId: string; admissionId: string; provisioned: boolean }
  | { ok: false; reason: "not_found" | "expired" | "full" };

/**
 * One Durable Object per room. Commander Link's source of truth: it owns room
 * metadata, admission/capacity (serialized so the 4-peer limit cannot be raced),
 * TTL, heartbeats and lifecycle/cleanup. It never proxies media, is not a
 * signalling server, and knows nothing about any specific voice provider.
 */
export class RoomGate extends DurableObject<Env> {
  private get maxPeers(): number {
    const parsed = Number.parseInt(this.env.MAX_ROOM_PEERS, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
  }

  private async getRoom(): Promise<RoomRecord | undefined> {
    return this.ctx.storage.get<RoomRecord>("room");
  }

  private async getLeases(): Promise<AdmissionLease[]> {
    return (await this.ctx.storage.get<AdmissionLease[]>("admissions")) ?? [];
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + CLEANUP_INTERVAL_MS);
    }
  }

  async init(expiresAt: number, roomId: string): Promise<void> {
    if (await this.getRoom()) return;
    await this.ctx.storage.put<RoomRecord>("room", {
      createdAt: Date.now(),
      expiresAt,
      roomId,
      provisioned: false,
      emptySince: null,
    });
    await this.ensureAlarm();
  }

  async meta(): Promise<RoomMetadata> {
    const room = await this.getRoom();
    if (!room || room.expiresAt <= Date.now()) {
      return {
        roomId: "",
        exists: false,
        expiresAt: room ? new Date(room.expiresAt).toISOString() : null,
        maxPeers: this.maxPeers,
        peerCount: 0,
      } as RoomMetadata;
    }
    const leases = pruneLeases(await this.getLeases(), Date.now());
    await this.ctx.storage.put("admissions", leases);
    return {
      roomId: "",
      exists: true,
      expiresAt: new Date(room.expiresAt).toISOString(),
      maxPeers: this.maxPeers,
      peerCount: leases.length,
    } as RoomMetadata;
  }

  async admit(displayName: string, admissionId?: string): Promise<AdmitResult> {
    const room = await this.getRoom();
    if (!room) return { ok: false, reason: "not_found" };
    if (room.expiresAt <= Date.now()) return { ok: false, reason: "expired" };

    const now = Date.now();
    const leases = pruneLeases(await this.getLeases(), now);
    const decision = decideAdmission({
      leases,
      maxPeers: this.maxPeers,
      now,
      displayName,
      admissionId,
      newAdmissionId: crypto.randomUUID(),
      newPeerId: hex(8),
    });
    if (!decision.ok) return { ok: false, reason: decision.reason };

    await this.ctx.storage.put("admissions", decision.leases);
    if (room.emptySince !== null) {
      room.emptySince = null;
      await this.ctx.storage.put("room", room);
    }
    await this.ensureAlarm();
    return {
      ok: true,
      peerId: decision.lease.peerId,
      admissionId: decision.lease.admissionId,
      provisioned: room.provisioned,
    };
  }

  /** Flag the backend session as provisioned after the first join created it. */
  async markProvisioned(): Promise<void> {
    const room = await this.getRoom();
    if (room && !room.provisioned) {
      room.provisioned = true;
      await this.ctx.storage.put("room", room);
    }
  }

  async heartbeat(admissionId: string): Promise<{ ok: boolean }> {
    const leases = await this.getLeases();
    const existing = leases.find((lease) => lease.admissionId === admissionId);
    if (!existing) return { ok: false };
    existing.lastSeen = Date.now();
    await this.ctx.storage.put("admissions", pruneLeases(leases, Date.now()));
    await this.ensureAlarm();
    return { ok: true };
  }

  async leave(admissionId: string): Promise<{ ok: boolean }> {
    const next = pruneLeases(
      (await this.getLeases()).filter((lease) => lease.admissionId !== admissionId),
      Date.now()
    );
    await this.ctx.storage.put("admissions", next);
    if (next.length === 0) {
      const room = await this.getRoom();
      if (room && room.emptySince === null) {
        room.emptySince = Date.now();
        await this.ctx.storage.put("room", room);
      }
    }
    await this.ensureAlarm();
    return { ok: true };
  }

  /**
   * Lifecycle safety net. Runs periodically to (1) drop participants whose
   * heartbeats timed out — covering crashes, sleep and network loss — and
   * (2) tear down the backend session and delete the room once it has been
   * empty past the grace period or has expired.
   */
  async alarm(): Promise<void> {
    const room = await this.getRoom();
    if (!room) return;

    const now = Date.now();
    const leases = pruneLeases(await this.getLeases(), now);
    await this.ctx.storage.put("admissions", leases);

    const expired = now >= room.expiresAt;

    if (leases.length > 0 && !expired) {
      if (room.emptySince !== null) {
        room.emptySince = null;
        await this.ctx.storage.put("room", room);
      }
      await this.ctx.storage.setAlarm(now + CLEANUP_INTERVAL_MS);
      return;
    }

    if (!expired) {
      // A room that was never joined lives until its TTL; only a used room is
      // cleaned up after the empty grace period.
      if (!room.provisioned) {
        await this.ctx.storage.setAlarm(now + CLEANUP_INTERVAL_MS);
        return;
      }
      if (room.emptySince === null) {
        room.emptySince = now;
        await this.ctx.storage.put("room", room);
      }
      if (now - room.emptySince < GRACE_MS) {
        await this.ctx.storage.setAlarm(now + CLEANUP_INTERVAL_MS);
        return;
      }
    }

    // Grace elapsed or room expired: tear down the transport session, then the room.
    if (room.provisioned) {
      await createVoiceBackend(this.env).deleteSession(room.roomId);
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

// ---------------------------------------------------------------------------
// Worker HTTP surface — the public API and secret boundary.
// ---------------------------------------------------------------------------

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  // Strict allowlist: only the configured web origin may call the API from a browser.
  if (origin && origin === env.APP_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  return headers;
}

function json(request: Request, env: Env, status: number, payload: unknown): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(payload), { status, headers });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 10_000) throw new Error("Request too large");
  return text ? JSON.parse(text) : {};
}

function ttlSeconds(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roomStub(env: Env, roomId: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const roomTtl = ttlSeconds(env.ROOM_TTL_SECONDS, 21_600);
  const roomId = hex(16); // 32 lowercase hex chars — an unguessable, URL-safe room id.
  const expiresAt = Date.now() + roomTtl * 1000;

  // Lazy provisioning: only record the Commander Link room. The voice backend
  // session is created on first join, so rooms nobody enters cost no resources.
  await roomStub(env, roomId).init(expiresAt, roomId);

  const body = CreateRoomResponseSchema.parse({
    roomId,
    expiresAt: new Date(expiresAt).toISOString(),
    inviteUrl: `${env.APP_ORIGIN}/r/${roomId}`,
  });
  return json(request, env, 201, body);
}

async function getRoomMeta(request: Request, env: Env, roomId: string): Promise<Response> {
  const meta = await roomStub(env, roomId).meta();
  return json(request, env, 200, { ...meta, roomId });
}

async function joinRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  let parsed;
  try {
    parsed = JoinRoomRequestSchema.parse(await readJson(request));
  } catch {
    return json(request, env, 400, { error: "invalid_request" });
  }

  const stub = roomStub(env, roomId);
  const admit = await stub.admit(parsed.displayName, parsed.admissionId);
  if (!admit.ok) {
    const status = admit.reason === "full" ? 409 : 404;
    return json(request, env, status, { error: admit.reason });
  }

  const backend = createVoiceBackend(env);

  // First participant lazily provisions the transport session (idempotent).
  if (!admit.provisioned) {
    try {
      await backend.createSession(roomId);
      await stub.markProvisioned();
    } catch {
      await stub.leave(admit.admissionId);
      return json(request, env, 502, { error: "session_provisioning_failed" });
    }
  }

  let session;
  try {
    session = await backend.createAccessToken(roomId, parsed.displayName);
  } catch {
    // Release the slot we just reserved so a token failure cannot leak capacity.
    await stub.leave(admit.admissionId);
    return json(request, env, 502, { error: "token_minting_failed" });
  }

  const tokenTtl = ttlSeconds(env.TOKEN_TTL_SECONDS, 3_600);
  return json(request, env, 200, {
    roomId,
    peerId: admit.peerId,
    token: session.token,
    roomUrl: session.roomUrl,
    tokenExpiresAt: new Date(Date.now() + tokenTtl * 1000).toISOString(),
    admissionId: admit.admissionId,
  });
}

async function leaveRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  let parsed;
  try {
    parsed = LeaveRoomRequestSchema.parse(await readJson(request));
  } catch {
    return json(request, env, 400, { error: "invalid_request" });
  }
  await roomStub(env, roomId).leave(parsed.admissionId);
  return json(request, env, 200, { ok: true });
}

async function heartbeatRoom(request: Request, env: Env, roomId: string): Promise<Response> {
  let parsed;
  try {
    parsed = LeaveRoomRequestSchema.parse(await readJson(request));
  } catch {
    return json(request, env, 400, { error: "invalid_request" });
  }
  const result = await roomStub(env, roomId).heartbeat(parsed.admissionId);
  return json(request, env, 200, result);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (pathname === "/health") {
      return json(request, env, 200, { ok: true });
    }

    if (pathname === "/v1/rooms" && request.method === "POST") {
      // TODO: attach Cloudflare rate limiting (per-IP create budget) at the edge.
      return createRoom(request, env);
    }

    const roomMatch = pathname.match(/^\/v1\/rooms\/([^/]+)(\/(join|leave|heartbeat))?$/);
    if (roomMatch) {
      const rawId = decodeURIComponent(roomMatch[1]);
      if (!RoomIdSchema.safeParse(rawId).success) {
        return json(request, env, 400, { error: "invalid_room_id" });
      }
      const action = roomMatch[3];
      if (!action && request.method === "GET") return getRoomMeta(request, env, rawId);
      if (action === "join" && request.method === "POST") return joinRoom(request, env, rawId);
      if (action === "leave" && request.method === "POST") return leaveRoom(request, env, rawId);
      if (action === "heartbeat" && request.method === "POST")
        return heartbeatRoom(request, env, rawId);
      return json(request, env, 405, { error: "method_not_allowed" });
    }

    return json(request, env, 404, { error: "not_found" });
  },
} satisfies ExportedHandler<Env>;
