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

export interface Env {
  ROOMS: DurableObjectNamespace<RoomGate>;
  // Metered app subdomain: <METERED_APP_NAME>.metered.live
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
  meteredRoomName: string;
}

export type AdmitResult =
  | { ok: true; peerId: string; admissionId: string; meteredRoomName: string }
  | { ok: false; reason: "not_found" | "expired" | "full" };

/**
 * One Durable Object per room. It is the *only* place admission/capacity is decided,
 * which serializes concurrent joins so the 4-peer limit cannot be raced. It never
 * proxies media and is not a signalling server.
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

  async init(expiresAt: number, meteredRoomName: string): Promise<void> {
    const existing = await this.getRoom();
    if (existing) return;
    await this.ctx.storage.put<RoomRecord>("room", {
      createdAt: Date.now(),
      expiresAt,
      meteredRoomName,
    });
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
    return {
      ok: true,
      peerId: decision.lease.peerId,
      admissionId: decision.lease.admissionId,
      meteredRoomName: room.meteredRoomName,
    };
  }

  async heartbeat(admissionId: string): Promise<{ ok: boolean }> {
    const leases = await this.getLeases();
    const existing = leases.find((lease) => lease.admissionId === admissionId);
    if (!existing) return { ok: false };
    existing.lastSeen = Date.now();
    await this.ctx.storage.put("admissions", pruneLeases(leases, Date.now()));
    return { ok: true };
  }

  async leave(admissionId: string): Promise<{ ok: boolean }> {
    const leases = await this.getLeases();
    const next = leases.filter((lease) => lease.admissionId !== admissionId);
    await this.ctx.storage.put("admissions", pruneLeases(next, Date.now()));
    return { ok: true };
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

class MeteredError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Server-to-server Metered REST call. The secret key stays here and is only ever
 * sent to metered.live — never returned to a client, never logged.
 */
async function meteredRequest(
  env: Env,
  endpoint: string,
  body: Record<string, unknown>,
  method: "POST" | "GET" | "DELETE" = "POST"
): Promise<Record<string, unknown>> {
  const url = new URL(`https://${env.METERED_APP_NAME}.metered.live${endpoint}`);
  url.searchParams.set("secretKey", env.METERED_SECRET_KEY);

  const isBodyless = method === "GET" || method === "DELETE";
  const response = await fetch(url.toString(), {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: isBodyless ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new MeteredError(`Metered API HTTP ${response.status}`, response.status);
  }
  return payload;
}

function ttlSeconds(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roomStub(env: Env, roomId: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

function roomUrl(env: Env, meteredRoomName: string): string {
  return `${env.METERED_APP_NAME}.metered.live/${meteredRoomName}`;
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const roomTtl = ttlSeconds(env.ROOM_TTL_SECONDS, 21_600);
  const roomId = hex(16); // 32 lowercase hex chars — valid Metered room name and RoomId.
  const expiresAt = Date.now() + roomTtl * 1000;

  await roomStub(env, roomId).init(expiresAt, roomId);

  // Audio-only, private room capped to the same peer limit the gate enforces.
  try {
    await meteredRequest(env, "/api/v1/room", {
      roomName: roomId,
      privacy: "private",
      audioOnlyRoom: true,
      autoJoin: true,
      joinVideoOn: false,
      joinAudioOn: false,
      enableChat: false,
      enableScreenSharing: false,
      showInviteBox: false,
      maxParticipants: Number.parseInt(env.MAX_ROOM_PEERS, 10) || 4,
      ejectAfterElapsedTimeInSec: roomTtl,
    });
  } catch (err) {
    const status = err instanceof MeteredError ? err.status : 502;
    // 400/409 means the room already exists in Metered — safe to continue.
    if (status !== 400 && status !== 409) {
      return json(request, env, 502, { error: "room_provisioning_failed" });
    }
  }

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

  const admit = await roomStub(env, roomId).admit(parsed.displayName, parsed.admissionId);
  if (!admit.ok) {
    const status = admit.reason === "full" ? 409 : 404;
    return json(request, env, status, { error: admit.reason });
  }

  let token: string;
  try {
    const result = await meteredRequest(env, "/api/v1/token", {
      roomName: admit.meteredRoomName,
      name: parsed.displayName,
      isAdmin: false,
    });
    token = (result.token as string) || (result.accessToken as string);
    if (!token) throw new MeteredError("no token", 502);
  } catch {
    // Release the slot we just reserved so a token failure cannot leak capacity.
    await roomStub(env, roomId).leave(admit.admissionId);
    return json(request, env, 502, { error: "token_minting_failed" });
  }

  const tokenTtl = ttlSeconds(env.TOKEN_TTL_SECONDS, 3_600);
  return json(request, env, 200, {
    roomId,
    peerId: admit.peerId,
    token,
    roomUrl: roomUrl(env, admit.meteredRoomName),
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
