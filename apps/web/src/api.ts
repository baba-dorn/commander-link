import {
  CreateRoomResponseSchema,
  JoinRoomResponseSchema,
  RoomMetadataSchema,
  type CreateRoomResponse,
  type JoinRoomResponse,
  type RoomMetadata,
} from "@commander-link/core";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return payload;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function createRoom(): Promise<CreateRoomResponse> {
  return CreateRoomResponseSchema.parse(await request("/v1/rooms", { method: "POST" }));
}

export async function getRoomMeta(roomId: string): Promise<RoomMetadata> {
  return RoomMetadataSchema.parse(await request(`/v1/rooms/${encodeURIComponent(roomId)}`));
}

export async function joinRoom(
  roomId: string,
  displayName: string,
  admissionId?: string
): Promise<JoinRoomResponse> {
  return JoinRoomResponseSchema.parse(
    await request(`/v1/rooms/${encodeURIComponent(roomId)}/join`, {
      method: "POST",
      body: JSON.stringify({ displayName, admissionId }),
    })
  );
}

export async function leaveRoom(roomId: string, admissionId: string): Promise<void> {
  await request(`/v1/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: "POST",
    body: JSON.stringify({ admissionId }),
  });
}

// Best-effort keep-alive so an abandoned lease is reclaimed, but active peers stay.
export function sendHeartbeat(roomId: string, admissionId: string): void {
  void fetch(`${API_BASE}/v1/rooms/${encodeURIComponent(roomId)}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admissionId }),
    keepalive: true,
  }).catch(() => {});
}
