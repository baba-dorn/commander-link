// Development-only diagnostics helpers. Everything here is intentionally safe to
// display: room/channel names, connection states and candidate types. Never pass
// tokens, TURN username/password or signing material into these functions.

interface StatsReportLike {
  id: string;
  type: string;
  selected?: boolean;
  nominated?: boolean;
  localCandidateId?: string;
  candidateType?: string;
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
