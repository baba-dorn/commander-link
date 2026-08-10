// Development-only diagnostics helpers. Everything here is intentionally safe to
// display: room/channel names, connection states, candidate types and byte/RTT
// counters. Never pass tokens, TURN username/password or signing material into
// these functions.

interface StatsReportLike {
  id: string;
  type: string;
  selected?: boolean;
  nominated?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  protocol?: string;
  currentRoundTripTime?: number;
  bytesSent?: number;
  bytesReceived?: number;
  packetsSent?: number;
  packetsReceived?: number;
  relayProtocol?: string;
  state?: string;
  candidate?: string;
  kind?: string;
}

function reportsFrom(stats: unknown): StatsReportLike[] {
  if (!stats || typeof stats !== "object") return [];
  const candidate = stats as { values?: () => Iterable<StatsReportLike> };
  if (typeof candidate.values === "function") {
    return Array.from(candidate.values());
  }
  return Object.values(stats as Record<string, StatsReportLike>);
}

/**
 * Extract the selected ICE candidate type (`host` | `srflx` | `relay` | `prflx`)
 * from an RTCStatsReport, or null when unavailable. This is how the diagnostics
 * view tells direct P2P apart from TURN relay.
 */
export function selectedCandidateType(stats: unknown): string | null {
  const reports = reportsFrom(stats);
  const pair = reports.find(
    (r) => r.type === "candidate-pair" && (r.selected === true || r.nominated === true)
  );
  if (!pair) return null;
  const localId = pair.localCandidateId;
  if (!localId) return null;
  const candidate = reports.find((r) => r.id === localId);
  const type = candidate?.candidateType;
  return typeof type === "string" && type.length > 0 ? type : null;
}

/** PeerConnection surface the transport hands in for diagnostics. */
export interface PeerConnectionDiagnostics {
  iceConnectionState?: string;
  getStats?: () => Promise<unknown>;
}

/** Best-effort async wrapper that never throws. */
export async function collectCandidateType(
  pc: PeerConnectionDiagnostics | null | undefined
): Promise<string | null> {
  if (!pc || typeof pc.getStats !== "function") return null;
  try {
    return selectedCandidateType(await pc.getStats());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Selected ICE candidate pair + audio RTP stats (verbose diagnostics)
// ---------------------------------------------------------------------------

export interface CandidatePairInfo {
  /** Selected candidate type from the local side: host | srflx | prflx | relay | null. */
  localCandidateType: string | null;
  /** Selected candidate type from the remote side: host | srflx | prflx | relay | null. */
  remoteCandidateType: string | null;
  /** Transport protocol of the selected pair: udp | tcp | null. */
  protocol: string | null;
  /** TURN relay protocol when the local side is relayed: udp | tcp | tls | null. */
  relayProtocol: string | null;
  /** ICE candidate pair state: succeeded | in-progress | failed | null. */
  pairState: string | null;
  /** currentRoundTripTime (ms) of the selected pair, or null. */
  currentRoundTripTime: number | null;
  /** Aggregate audio bytes sent across all outbound-rtp entries. */
  bytesSent: number | null;
  /** Aggregate audio bytes received across all inbound-rtp entries. */
  bytesReceived: number | null;
  /** Aggregate audio packets sent. */
  packetsSent: number | null;
  /** Aggregate audio packets received. */
  packetsReceived: number | null;
}

export function selectedCandidatePair(stats: unknown): CandidatePairInfo {
  const empty: CandidatePairInfo = {
    localCandidateType: null,
    remoteCandidateType: null,
    protocol: null,
    relayProtocol: null,
    pairState: null,
    currentRoundTripTime: null,
    bytesSent: null,
    bytesReceived: null,
    packetsSent: null,
    packetsReceived: null,
  };
  const reports = reportsFrom(stats);
  if (reports.length === 0) return empty;

  const pair = reports.find(
    (r) => r.type === "candidate-pair" && (r.selected === true || r.nominated === true)
  );

  let local: StatsReportLike | undefined;
  let remote: StatsReportLike | undefined;
  if (pair) {
    local = pair.localCandidateId ? reports.find((r) => r.id === pair.localCandidateId) : undefined;
    remote = pair.remoteCandidateId
      ? reports.find((r) => r.id === pair.remoteCandidateId)
      : undefined;
  }

  let bytesSent = 0;
  let bytesReceived = 0;
  let packetsSent = 0;
  let packetsReceived = 0;
  let hasOutboundBytes = false;
  let hasInboundBytes = false;
  let hasOutboundPackets = false;
  let hasInboundPackets = false;
  for (const r of reports) {
    // Only audio RTP stats are meaningful here (no video in Commander Link).
    if (r.type !== "outbound-rtp" && r.type !== "inbound-rtp") continue;
    if (typeof r.kind === "string" && r.kind !== "audio") continue;
    if (r.type === "outbound-rtp") {
      if (typeof r.bytesSent === "number") {
        bytesSent += r.bytesSent;
        hasOutboundBytes = true;
      }
      if (typeof r.packetsSent === "number") {
        packetsSent += r.packetsSent;
        hasOutboundPackets = true;
      }
    } else {
      if (typeof r.bytesReceived === "number") {
        bytesReceived += r.bytesReceived;
        hasInboundBytes = true;
      }
      if (typeof r.packetsReceived === "number") {
        packetsReceived += r.packetsReceived;
        hasInboundPackets = true;
      }
    }
  }

  return {
    localCandidateType: typeof local?.candidateType === "string" ? local.candidateType : null,
    remoteCandidateType: typeof remote?.candidateType === "string" ? remote.candidateType : null,
    protocol: typeof pair?.protocol === "string" ? pair.protocol : null,
    relayProtocol: typeof local?.relayProtocol === "string" ? local.relayProtocol : null,
    pairState: typeof pair?.state === "string" ? pair.state : null,
    currentRoundTripTime:
      pair && typeof pair.currentRoundTripTime === "number" && Number.isFinite(pair.currentRoundTripTime)
        ? pair.currentRoundTripTime
        : null,
    bytesSent: hasOutboundBytes ? bytesSent : null,
    bytesReceived: hasInboundBytes ? bytesReceived : null,
    packetsSent: hasOutboundPackets ? packetsSent : null,
    packetsReceived: hasInboundPackets ? packetsReceived : null,
  };
}

/** Compact single-line form for console snapshots: "local=relay remote=srflx udp rtt=42ms sent=1234 recv=5678". */
export function candidatePairSummary(info: CandidatePairInfo): string {
  const parts: string[] = [];
  parts.push(`local=${info.localCandidateType ?? "n/a"}`);
  parts.push(`remote=${info.remoteCandidateType ?? "n/a"}`);
  parts.push(info.protocol ?? "n/a");
  if (info.relayProtocol) parts.push(`relay=${info.relayProtocol}`);
  if (info.pairState) parts.push(`state=${info.pairState}`);
  if (info.currentRoundTripTime !== null) parts.push(`rtt=${info.currentRoundTripTime.toFixed(1)}ms`);
  if (info.bytesSent !== null) parts.push(`sent=${info.bytesSent}`);
  if (info.bytesReceived !== null) parts.push(`recv=${info.bytesReceived}`);
  if (info.packetsSent !== null) parts.push(`packetsSent=${info.packetsSent}`);
  if (info.packetsReceived !== null) parts.push(`packetsReceived=${info.packetsReceived}`);
  return parts.join(" ");
}

/** Best-effort async wrapper for the full candidate-pair snapshot. Never throws. */
export async function collectCandidatePair(
  pc: PeerConnectionDiagnostics | null | undefined
): Promise<CandidatePairInfo> {
  if (!pc || typeof pc.getStats !== "function") return selectedCandidatePair(undefined);
  try {
    return selectedCandidatePair(await pc.getStats());
  } catch {
    return selectedCandidatePair(undefined);
  }
}
