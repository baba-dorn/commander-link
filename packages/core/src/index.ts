import { z } from "zod";

export const RoomIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);
export type RoomId = z.infer<typeof RoomIdSchema>;

export const CreateRoomResponseSchema = z.object({
  roomId: RoomIdSchema,
  expiresAt: z.string().datetime(),
  inviteUrl: z.string().url(),
});

export const JoinRoomRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(48),
  admissionId: z.string().uuid().optional(),
});

export const JoinRoomResponseSchema = z.object({
  roomId: RoomIdSchema,
  peerId: z.string().min(1).max(128),
  token: z.string().min(1),
  tokenExpiresAt: z.string(),
  admissionId: z.string().uuid(),
});

export type PttState = "muted" | "transmitting" | "blocked" | "disconnected";
export type PttEvent = "press" | "release" | "blur" | "hidden" | "disconnect" | "reconnect" | "error";

export function reducePtt(state: PttState, event: PttEvent): PttState {
  if (event === "disconnect") return "disconnected";
  if (event === "error") return "blocked";
  if (event === "reconnect") return "muted";
  if (event === "release" || event === "blur" || event === "hidden") return "muted";
  if (event === "press" && state === "muted") return "transmitting";
  return state;
}
