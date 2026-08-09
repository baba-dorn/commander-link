import { describe, expect, it } from "vitest";
import { deepLinkFromArgv, roomFromDeepLink, isValidRoomId } from "./deep-link";

const ROOM_ID = "bb63eaf988d4415e8f23413c4eeb566";

describe("roomFromDeepLink", () => {
  it("recognizes a valid room deep link", () => {
    expect(roomFromDeepLink(`commanderlink://join/${ROOM_ID}`)).toBe(ROOM_ID);
  });

  it("recognizes the canonical deep link form for a room", () => {
    expect(roomFromDeepLink(`commanderlink://join/${ROOM_ID}`)).toBe(ROOM_ID);
  });

  it("rejects an unsupported protocol", () => {
    expect(roomFromDeepLink(`https://example.com/r/${ROOM_ID}`)).toBeNull();
    expect(roomFromDeepLink(`custom://join/${ROOM_ID}`)).toBeNull();
  });

  it("rejects a malformed or short room id", () => {
    expect(roomFromDeepLink("commanderlink://join/abc")).toBeNull();
    expect(roomFromDeepLink("commanderlink://join/")).toBeNull();
  });

  it("rejects non-join routes and arbitrary navigation", () => {
    expect(roomFromDeepLink("commanderlink://open/https://evil.example")).toBeNull();
    expect(roomFromDeepLink("commanderlink://../../etc/passwd")).toBeNull();
    expect(roomFromDeepLink("commanderlink://join/..")).toBeNull();
  });

  it("rejects undefined / empty input", () => {
    expect(roomFromDeepLink(undefined)).toBeNull();
    expect(roomFromDeepLink("")).toBeNull();
  });
});

describe("deepLinkFromArgv", () => {
  it("finds the room from a launched argv", () => {
    const argv = ["/path/to/app.exe", `commanderlink://join/${ROOM_ID}`];
    expect(deepLinkFromArgv(argv)).toBe(ROOM_ID);
  });

  it("returns null when argv has no deep link", () => {
    expect(deepLinkFromArgv([])).toBeNull();
    expect(deepLinkFromArgv(["app.exe", "--flag"])).toBeNull();
  });

  it("skips malformed deep links", () => {
    const argv = ["app.exe", "commanderlink://join/tiny"];
    expect(deepLinkFromArgv(argv)).toBeNull();
  });
});

describe("isValidRoomId", () => {
  it("accepts a well-formed room id", () => {
    expect(isValidRoomId(ROOM_ID)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isValidRoomId("short")).toBe(false);
    expect(isValidRoomId(`${ROOM_ID}/..`)).toBe(false);
    expect(isValidRoomId("")).toBe(false);
  });
});
