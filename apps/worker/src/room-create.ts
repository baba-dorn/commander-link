/**
 * Authorization for room initialization.
 *
 * Rooms may ONLY be created through the authorized Discord integration. The
 * Discord worker authenticates with a shared server-to-server secret
 * (`ROOM_CREATE_SECRET`) sent as `Authorization: Bearer <secret>`. This module
 * is the single, pure place that enforces that boundary so the 4-peer room
 * admission limit and the rest of the Worker cannot be reached by arbitrary
 * public clients. There is intentionally no separate creator account, key or
 * database — Discord guild + commander-role authorization is upstream of this.
 */

/** Constant-time string compare to avoid leaking the secret length/timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Extract and verify the shared server-to-server token from a request's
 * `Authorization` header. Returns true only when the header is exactly
 * `Bearer <configured secret>` — never when missing, malformed or mismatched.
 */
export function authorizeRoomCreate(
  authorization: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authorization) return false;
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match) return false;
  return timingSafeEqual(match[1], secret);
}
