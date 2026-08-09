import { describe, expect, it } from "vitest";
import { extractRoomId } from "@commander-link/core";
import fs from "node:fs";
import path from "node:path";

const ROOM_ID = "bb63eaf988d4415e8f23413c4eeb566";

// The homepage is join-only: a visitor pastes an invite link, deep link or raw
// room code and the shared extractRoomId parses it. These cover "existing room
// can still be joined" and "direct invitation URL still works".
  describe("home join field", () => {
  it("parses a direct HTTPS invitation URL", () => {
    expect(extractRoomId(`https://commander-link.joinoops.win/r/${ROOM_ID}`)).toBe(ROOM_ID);
  });

  it("parses a commanderlink deep link", () => {
    expect(extractRoomId(`commanderlink://join/${ROOM_ID}`)).toBe(ROOM_ID);
  });

  it("parses a raw room id", () => {
    expect(extractRoomId(ROOM_ID)).toBe(ROOM_ID);
  });

  it("rejects a room code embedded in arbitrary text without a room prefix", () => {
    expect(extractRoomId(`hier: ${ROOM_ID}`)).toBeNull();
  });

  it("rejects a malformed or empty input", () => {
    expect(extractRoomId("")).toBeNull();
    expect(extractRoomId("   ")).toBeNull();
    expect(extractRoomId("not-a-room")).toBeNull();
  });
});

// Guard against regressing to public room creation: the shared web app must not
// expose or call a public room-creation API path anymore. Joining an existing
// room remains the only supported web workflow.
describe("no public room creation in the web client", () => {
  const apiSource = fs.readFileSync(path.join(__dirname, "api.ts"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "main.tsx"), "utf8");

  it("does not export a createRoom client call", () => {
    expect(apiSource).not.toMatch(/export\s+function\s+createRoom/);
    expect(apiSource).not.toMatch(/\/rooms"\s*,\s*\{\s*method:\s*"POST"/);
  });

  it("does not render a create-room form or button on the home page", () => {
    expect(mainSource).not.toMatch(/createRoom/);
    expect(mainSource).not.toMatch(/Raum erstellen/);
  });

  it("relies on join for the only web workflow", () => {
    expect(mainSource).toMatch(/joinRoom/);
  });
});
