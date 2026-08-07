import { describe, expect, it } from "vitest";
import {
  decideAdmission,
  pruneLeases,
  LEASE_IDLE_MS,
  type AdmissionLease,
} from "./index";

function lease(id: string, lastSeen: number): AdmissionLease {
  return { admissionId: id, peerId: `p-${id}`, displayName: id, joinedAt: 0, lastSeen };
}

describe("decideAdmission", () => {
  const NOW = 1_000_000;

  it("admits up to maxPeers and rejects the next one", () => {
    let leases: AdmissionLease[] = [];
    for (let i = 0; i < 4; i += 1) {
      const decision = decideAdmission({
        leases,
        maxPeers: 4,
        now: NOW,
        displayName: `peer-${i}`,
        newAdmissionId: `a-${i}`,
        newPeerId: `p-${i}`,
      });
      expect(decision.ok).toBe(true);
      if (decision.ok) leases = decision.leases;
    }
    expect(leases).toHaveLength(4);

    const fifth = decideAdmission({
      leases,
      maxPeers: 4,
      now: NOW,
      displayName: "peer-5",
      newAdmissionId: "a-5",
      newPeerId: "p-5",
    });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.reason).toBe("full");
  });

  it("reuses an existing lease on reconnect without consuming a slot", () => {
    const leases = [lease("keep", NOW - 1000)];
    const decision = decideAdmission({
      leases,
      maxPeers: 1,
      now: NOW,
      displayName: "keep",
      admissionId: "keep",
      newAdmissionId: "a-new",
      newPeerId: "p-new",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.reused).toBe(true);
      expect(decision.leases).toHaveLength(1);
      expect(decision.lease.lastSeen).toBe(NOW);
      expect(decision.lease.peerId).toBe("p-keep");
    }
  });
});

describe("pruneLeases", () => {
  const NOW = 5_000_000;
  it("drops leases idle beyond the lease window", () => {
    const fresh = lease("fresh", NOW - 1000);
    const stale = lease("stale", NOW - LEASE_IDLE_MS - 1);
    expect(pruneLeases([fresh, stale], NOW)).toEqual([fresh]);
  });
});
