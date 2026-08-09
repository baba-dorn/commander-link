// Desktop deep-link parsing. The custom protocol scheme mirrors the rest of the
// project (see `packages/core` `DEEP_LINK_PROTOCOL`) but is deliberately kept
// local and runtime-free here: `@commander-link/core` is a type-only dependency
// of the desktop shell, and the parsed room id is validated against the same
// shape the rest of the app accepts (lower/upper hex + digits, 20–128 chars).

const DEEP_LINK_PROTOCOL = "commanderlink";

/** Room id shape shared with the browser join field (`RoomIdSchema`). */
const ROOM_ID = /^[A-Za-z0-9_-]{20,128}$/;

/** Validate a room id format before any navigation. */
export function isValidRoomId(id: string): boolean {
  return ROOM_ID.test(id);
}

/**
 * Extract a validated room id from a `commanderlink://join/<id>` deep link.
 * Deep links are untrusted input: only `commanderlink://join/<roomId>` (or the
 * equivalent current join route) is accepted. Unsupported protocols, malformed
 * routes, non-room navigation and arbitrary URLs return `null`.
 */
export function roomFromDeepLink(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) return null;
    // commanderlink://join/<id>  -> host "join", pathname "/<id>"
    const id = parsed.pathname.replace(/^\/+/, "") || parsed.searchParams.get("room") || "";
    return ROOM_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Scan an argv list (from a second launch) for the first valid deep link room. */
export function deepLinkFromArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (!arg.startsWith(`${DEEP_LINK_PROTOCOL}://`)) continue;
    const room = roomFromDeepLink(arg);
    if (room) return room;
  }
  return null;
}
