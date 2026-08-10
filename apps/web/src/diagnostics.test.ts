import { describe, expect, it } from "vitest";
import {
  addGatheredCandidate,
  addressFamilyOf,
  candidatePairSummary,
  candidateTypeOf,
  collectCandidatePair,
  collectCandidateType,
  emptyGatheredCandidates,
  gatheredCandidatesLine,
  iceServersSummaryLine,
  parseIceServerUrl,
  protocolOf,
  selectedCandidatePair,
  selectedCandidateType,
  summarizeIceServers,
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

describe("parseIceServerUrl", () => {
  it("parses a plain stun URL", () => {
    expect(parseIceServerUrl("stun:stun.l.google.com:19302")).toEqual({
      scheme: "stun",
      hostname: "stun.l.google.com",
      port: "19302",
      transport: null,
      hasUsername: false,
      hasCredential: false,
    });
  });

  it("parses a turns URL with explicit transport and strips credentials", () => {
    const info = parseIceServerUrl(
      "turns:turn.example.com:5349?transport=tcp"
    );
    expect(info).toEqual({
      scheme: "turns",
      hostname: "turn.example.com",
      port: "5349",
      transport: "tcp",
      hasUsername: false,
      hasCredential: false,
    });
  });

  it("flags embedded userinfo without exposing its value", () => {
    const info = parseIceServerUrl("turn:user123:super-secret@turn.example.com:3478");
    expect(info?.scheme).toBe("turn");
    expect(info?.hostname).toBe("turn.example.com");
    expect(info?.port).toBe("3478");
    expect(info?.hasUsername).toBe(true);
    expect(info?.hasCredential).toBe(true);
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("user123");
  });

  it("handles IPv6 bracket hosts", () => {
    const info = parseIceServerUrl("stun:[2001:db8::1]:3478");
    expect(info?.hostname).toBe("2001:db8::1");
    expect(info?.port).toBe("3478");
  });

  it("returns null for non-strings and marks unknown schemes", () => {
    expect(parseIceServerUrl(42)).toBeNull();
    expect(parseIceServerUrl("")).toBeNull();
    expect(parseIceServerUrl("http://example.com")?.scheme).toBe("other");
  });

  it("defaults to null port/transport when omitted", () => {
    const info = parseIceServerUrl("stun:stun.example.com");
    expect(info?.port).toBeNull();
    expect(info?.transport).toBeNull();
  });
});

describe("summarizeIceServers", () => {
  it("counts STUN vs TURN entries from urls arrays and dictionary fields", () => {
    const summary = summarizeIceServers([
      { urls: ["stun:stun.example.com:3478", "stun:stun2.example.com:3478"] },
      {
        urls: "turn:turn.example.com:3478?transport=udp",
        username: "ts",
        credential: "hmac-secret",
      },
      { urls: "turns:turn.example.com:5349?transport=tcp" },
      { urls: "not-an-ice-url" },
      "not-an-object",
    ]);
    expect(summary.received).toBe(true);
    expect(summary.stunCount).toBe(2);
    expect(summary.turnCount).toBe(2);
    const turnEntry = summary.entries.find((e) => e.scheme === "turn");
    expect(turnEntry?.hasUsername).toBe(true);
    expect(turnEntry?.hasCredential).toBe(true);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("hmac-secret");
    expect(serialized).not.toContain("ts");
  });

  it("reports received=false when iceServers is absent or empty", () => {
    expect(summarizeIceServers(undefined).received).toBe(false);
    expect(summarizeIceServers([]).received).toBe(false);
    expect(summarizeIceServers({ urls: [] }).received).toBe(false);
  });

  it("renders a compact summary line without secrets", () => {
    const summary = summarizeIceServers([
      { urls: "turn:turn.example.com:3478?transport=udp", username: "u", credential: "c" },
      { urls: "stun:stun.example.com:3478" },
    ]);
    const line = iceServersSummaryLine(summary);
    expect(line).toContain("received=YES");
    expect(line).toContain("stun=1 turn=1");
    expect(line).toContain("turn:turn.example.com:3478");
    expect(line).not.toContain("username");
    expect(line).not.toContain("credential");
    expect(line).not.toContain(":c");
  });
});

describe("ICE candidate gathering helpers", () => {
  it("counts candidate types and flags TURN", () => {
    let s = emptyGatheredCandidates();
    s = addGatheredCandidate(s, "host");
    s = addGatheredCandidate(s, "host");
    s = addGatheredCandidate(s, "srflx");
    s = addGatheredCandidate(s, "relay");
    expect(s).toEqual({ host: 2, srflx: 1, prflx: 0, relay: 1, total: 4, turnCandidate: true });
    expect(gatheredCandidatesLine(s)).toBe(
      "host=2 srflx=1 prflx=0 relay=1 total=4 turnCandidate=YES"
    );
  });

  it("keeps turnCandidate false when only host/srflx are gathered", () => {
    let s = emptyGatheredCandidates();
    s = addGatheredCandidate(s, "host");
    s = addGatheredCandidate(s, "srflx");
    expect(s.turnCandidate).toBe(false);
  });

  it("extracts candidate type and protocol from events without exposing addresses", () => {
    const ev = {
      type: "host",
      protocol: "udp",
      candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host",
    };
    expect(candidateTypeOf(ev)).toBe("host");
    expect(protocolOf(ev)).toBe("udp");
    expect(candidateTypeOf({ candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ srflx" })).toBe("srflx");
    expect(protocolOf({ candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ srflx" })).toBe("udp");
    expect(candidateTypeOf(null)).toBeNull();
    expect(protocolOf({})).toBeNull();
  });

  it("detects address family without returning the address", () => {
    expect(addressFamilyOf({ address: "192.0.2.1" })).toBeNull();
    expect(addressFamilyOf({ address: "2001:db8::1" })).toBe("IPv6");
    expect(addressFamilyOf({ addressFamily: "IPv4" })).toBe("IPv4");
  });
});
