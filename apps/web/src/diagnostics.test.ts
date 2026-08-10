import { describe, expect, it } from "vitest";
import {
  candidatePairSummary,
  collectCandidatePair,
  collectCandidateType,
  selectedCandidatePair,
  selectedCandidateType,
} from "./diagnostics";

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

describe("selectedCandidatePair", () => {
  it("extracts the selected pair's candidate types, protocol, RTT and state", () => {
    const stats = report([
      {
        id: "pair1",
        type: "candidate-pair",
        selected: true,
        localCandidateId: "cand-local",
        remoteCandidateId: "cand-remote",
        protocol: "udp",
        state: "succeeded",
        currentRoundTripTime: 42.5,
      },
      { id: "cand-local", type: "local-candidate", candidateType: "relay", relayProtocol: "udp" },
      { id: "cand-remote", type: "remote-candidate", candidateType: "srflx" },
    ]);
    const pair = selectedCandidatePair(stats);
    expect(pair.localCandidateType).toBe("relay");
    expect(pair.remoteCandidateType).toBe("srflx");
    expect(pair.protocol).toBe("udp");
    expect(pair.relayProtocol).toBe("udp");
    expect(pair.pairState).toBe("succeeded");
    expect(pair.currentRoundTripTime).toBe(42.5);
  });

  it("returns nulls when no selected pair exists", () => {
    const pair = selectedCandidatePair(report([{ id: "only", type: "peer-connection" }]));
    expect(pair.localCandidateType).toBeNull();
    expect(pair.remoteCandidateType).toBeNull();
    expect(pair.protocol).toBeNull();
    expect(pair.currentRoundTripTime).toBeNull();
  });

  it("sums audio RTP counters across in/outbound-rtp entries", () => {
    const stats = report([
      { id: "a", type: "outbound-rtp", kind: "audio", bytesSent: 100, packetsSent: 10 },
      { id: "b", type: "outbound-rtp", kind: "video", bytesSent: 9000, packetsSent: 900 },
      { id: "c", type: "inbound-rtp", kind: "audio", bytesReceived: 50, packetsReceived: 5 },
    ]);
    const pair = selectedCandidatePair(stats);
    expect(pair.bytesSent).toBe(100);
    expect(pair.packetsSent).toBe(10);
    expect(pair.bytesReceived).toBe(50);
    expect(pair.packetsReceived).toBe(5);
  });

  it("leaves counters null when no RTP reports exist", () => {
    const pair = selectedCandidatePair(undefined);
    expect(pair.bytesSent).toBeNull();
    expect(pair.bytesReceived).toBeNull();
    expect(pair.packetsSent).toBeNull();
    expect(pair.packetsReceived).toBeNull();
  });
});

describe("candidatePairSummary", () => {
  it("renders a compact one-line summary", () => {
    const info = selectedCandidatePair(
      report([
        {
          id: "pair1",
          type: "candidate-pair",
          selected: true,
          localCandidateId: "l",
          remoteCandidateId: "r",
          protocol: "udp",
          state: "succeeded",
          currentRoundTripTime: 12.3,
        },
        { id: "l", type: "local-candidate", candidateType: "host" },
        { id: "r", type: "remote-candidate", candidateType: "srflx" },
        { id: "out", type: "outbound-rtp", bytesSent: 7 },
      ])
    );
    expect(candidatePairSummary(info)).toBe(
      "local=host remote=srflx udp state=succeeded rtt=12.3ms sent=7"
    );
  });
});

describe("collectCandidatePair", () => {
  it("returns empty info when getStats is unavailable", async () => {
    const pair = await collectCandidatePair(null);
    expect(pair.localCandidateType).toBeNull();
    expect(pair.bytesSent).toBeNull();
  });

  it("resolves the full snapshot from getStats", async () => {
    const stats = report([
      {
        id: "pair1",
        type: "candidate-pair",
        nominated: true,
        localCandidateId: "l",
        remoteCandidateId: "r",
        protocol: "udp",
        currentRoundTripTime: 8,
      },
      { id: "l", type: "local-candidate", candidateType: "relay" },
      { id: "r", type: "remote-candidate", candidateType: "relay" },
    ]);
    const pair = await collectCandidatePair({ getStats: async () => stats });
    expect(pair.localCandidateType).toBe("relay");
    expect(pair.remoteCandidateType).toBe("relay");
    expect(pair.protocol).toBe("udp");
    expect(pair.currentRoundTripTime).toBe(8);
  });

  it("never throws on getStats failure", async () => {
    const pair = await collectCandidatePair({
      getStats: async () => {
        throw new Error("nope");
      },
    });
    expect(pair.localCandidateType).toBeNull();
  });
});
