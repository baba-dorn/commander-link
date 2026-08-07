import { describe, expect, it } from "vitest";
import { collectCandidateType, selectedCandidateType } from "./diagnostics";

function report(values: Array<Record<string, unknown>>) {
  const map = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    map.set(String(value.id), value);
  }
  return map;
}

describe("selectedCandidateType", () => {
  it("returns host for a direct local candidate", () => {
    const stats = report([
      { id: "pair1", type: "candidate-pair", selected: true, localCandidateId: "cand-local" },
      { id: "cand-local", type: "local-candidate", candidateType: "host" },
    ]);
    expect(selectedCandidateType(stats)).toBe("host");
  });

  it("returns srflx for a server-reflexive candidate", () => {
    const stats = report([
      { id: "pair1", type: "candidate-pair", nominated: true, localCandidateId: "cand-local" },
      { id: "cand-local", type: "local-candidate", candidateType: "srflx" },
    ]);
    expect(selectedCandidateType(stats)).toBe("srflx");
  });

  it("returns relay for a TURN-relayed connection", () => {
    const stats = report([
      { id: "pair1", type: "candidate-pair", selected: true, localCandidateId: "cand-local" },
      { id: "cand-local", type: "local-candidate", candidateType: "relay" },
    ]);
    expect(selectedCandidateType(stats)).toBe("relay");
  });

  it("returns null when no selected pair or candidate exists", () => {
    expect(selectedCandidateType(undefined)).toBeNull();
    expect(selectedCandidateType(null)).toBeNull();
    expect(
      selectedCandidateType(report([{ id: "only", type: "peer-connection" }]))
    ).toBeNull();
    expect(
      selectedCandidateType(report([{ id: "pair1", type: "candidate-pair", selected: true }]))
    ).toBeNull();
  });

  it("handles a plain-object report", () => {
    const stats = {
      pair1: { id: "pair1", type: "candidate-pair", selected: true, localCandidateId: "cand-local" },
      "cand-local": { id: "cand-local", type: "local-candidate", candidateType: "relay" },
    };
    expect(selectedCandidateType(stats)).toBe("relay");
  });
});

describe("collectCandidateType", () => {
  it("returns null when getStats is unavailable", async () => {
    expect(await collectCandidateType(null)).toBeNull();
    expect(await collectCandidateType({ iceConnectionState: "connected" })).toBeNull();
  });

  it("resolves the candidate type from getStats", async () => {
    const stats = report([
      { id: "pair1", type: "candidate-pair", selected: true, localCandidateId: "cand-local" },
      { id: "cand-local", type: "local-candidate", candidateType: "srflx" },
    ]);
    expect(await collectCandidateType({ getStats: async () => stats })).toBe("srflx");
  });

  it("never throws on getStats failure", async () => {
    expect(
      await collectCandidateType({
        getStats: async () => {
          throw new Error("nope");
        },
      })
    ).toBeNull();
  });
});
