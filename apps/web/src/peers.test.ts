import { describe, expect, it } from "vitest";
import {
  applyPeerJoined,
  applyPeerLeft,
  nameFromMetadata,
  toPeerViews,
  type RosterEntry,
} from "./peers";

describe("participant roster mapping", () => {
  it("adds a remote peer on peer-joined (participant mapping)", () => {
    let roster: RosterEntry[] = [];
    roster = applyPeerJoined(roster, { id: "peer-a", name: "Dorn" });
    roster = applyPeerJoined(roster, { id: "peer-b", name: "Kai" });

    const views = toPeerViews(roster, new Map());
    expect(views).toEqual([
      { id: "peer-a", name: "Dorn", volume: 1 },
      { id: "peer-b", name: "Kai", volume: 1 },
    ]);
  });

  it("keeps join order and does not duplicate ids", () => {
    let roster: RosterEntry[] = [];
    roster = applyPeerJoined(roster, { id: "a", name: "A" });
    roster = applyPeerJoined(roster, { id: "b", name: "B" });
    roster = applyPeerJoined(roster, { id: "a", name: "A2" }); // rejoin/rename
    expect(roster.map((e) => e.id)).toEqual(["a", "b"]);
    expect(roster[0].name).toBe("A2");
  });

  it("removes a peer cleanly on peer-left", () => {
    let roster: RosterEntry[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ];
    roster = applyPeerLeft(roster, "b");
    expect(roster.map((e) => e.id)).toEqual(["a", "c"]);
    // Removing an unknown peer is a no-op.
    roster = applyPeerLeft(roster, "zzz");
    expect(roster.map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("applies per-peer playback volume", () => {
    const roster: RosterEntry[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const views = toPeerViews(roster, new Map([["b", 0.5]]));
    expect(views[1].volume).toBe(0.5);
    expect(views[0].volume).toBe(1);
  });
});

describe("nameFromMetadata", () => {
  it("reads username from JWT peerMetadata", () => {
    expect(nameFromMetadata({ username: "Dorn" })).toBe("Dorn");
  });

  it("returns empty string for missing or malformed metadata", () => {
    expect(nameFromMetadata(undefined)).toBe("");
    expect(nameFromMetadata({})).toBe("");
    expect(nameFromMetadata({ username: 42 })).toBe("");
    expect(nameFromMetadata({ username: "" })).toBe("");
  });
});
