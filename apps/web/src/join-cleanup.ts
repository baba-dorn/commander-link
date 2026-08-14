import type { JoinRoomResponse } from "@commander-link/core";
import type { VoiceTransport } from "./transport";

export type ReleaseAdmission = (roomId: string, admissionId: string) => Promise<void>;

/**
 * Undo the server-side admission when microphone access or transport setup
 * fails after the join endpoint has already reserved a slot.
 *
 * Cleanup is best-effort by design, but each operation is isolated so a failed
 * transport teardown cannot prevent releasing the capacity lease.
 */
export async function cleanupFailedJoin(
  roomId: string,
  session: JoinRoomResponse | null,
  connection: VoiceTransport,
  releaseAdmission: ReleaseAdmission,
): Promise<void> {
  await connection.disconnect().catch(() => {});
  if (session) {
    await releaseAdmission(roomId, session.admissionId).catch(() => {});
  }
}
