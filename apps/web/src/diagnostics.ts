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

// ---------------------------------------------------------------------------
// Sanitized ICE server config (welcome frame / RTCPeerConnection configuration)
// ---------------------------------------------------------------------------

export interface IceServerInfo {
  /** ice URL scheme: stun | stuns | turn | turns | other. */
  scheme: string;
  /** Hostname only — never the IP or any credential. */
  hostname: string;
  /** Port when explicitly present, else null. */
  port: string | null;
  /** Explicit transport from the query (udp | tcp) when present, else null. */
  transport: "udp" | "tcp" | null;
  /** Whether a username was supplied (value never logged). */
  hasUsername: boolean;
  /** Whether a credential was supplied (value never logged). */
  hasCredential: boolean;
}

/**
 * Parse a single `stun:`/`turns:` ICE URL into scheme/hostname/port/transport.
 * Usernames/passwords (embedded as `user:pass@` or dictionary fields) are never
 * extracted as values — only their presence is flagged. Returns null for
 * anything that is not a string.
 */
export function parseIceServerUrl(url: unknown): IceServerInfo | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const match = url.match(/^(stuns?|turns?):(.*)$/i);
  if (!match) {
    return { scheme: "other", hostname: "", port: null, transport: null, hasUsername: false, hasCredential: false };
  }
  const scheme = match[1].toLowerCase();
  const rest = match[2];

  const atIdx = rest.indexOf("@");
  let hostPort = atIdx >= 0 ? rest.slice(atIdx + 1) : rest;
  const hasUserInfo = atIdx >= 0;

  let transport: "udp" | "tcp" | null = null;
  const qIdx = hostPort.indexOf("?");
  if (qIdx >= 0) {
    const query = hostPort.slice(qIdx + 1);
    hostPort = hostPort.slice(0, qIdx);
    const t = query.match(/(?:^|&)transport=(udp|tcp)/i);
    if (t) transport = t[1].toLowerCase() as "udp" | "tcp";
  }

  let hostname = hostPort;
  let port: string | null = null;
  // IPv6 in brackets: [::1]:3478
  const ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (ipv6) {
    hostname = ipv6[1];
    port = ipv6[2] ?? null;
  } else {
    const lastColon = hostPort.lastIndexOf(":");
    if (lastColon > 0) {
      const maybePort = hostPort.slice(lastColon + 1);
      if (/^\d{1,5}$/.test(maybePort)) {
        hostname = hostPort.slice(0, lastColon);
        port = maybePort;
      }
    }
  }

  return {
    scheme,
    hostname,
    port,
    transport,
    hasUsername: hasUserInfo,
    hasCredential: hasUserInfo,
  };
}

export interface IceServersSummary {
  /** Whether at least one parseable ICE server entry was received. */
  received: boolean;
  /** Number of stun/stuns entries. */
  stunCount: number;
  /** Number of turn/turns entries. */
  turnCount: number;
  /** Sanitized per-entry details (scheme/hostname/port/transport only). */
  entries: IceServerInfo[];
}

/**
 * Summarize an `iceServers` array (from the Metered welcome frame or an
 * RTCPeerConnection configuration) into counts + sanitized entries. Credential
 * values are never copied — only `hasUsername`/`hasCredential` flags survive.
 */
export function summarizeIceServers(iceServers: unknown): IceServersSummary {
  const empty: IceServersSummary = { received: false, stunCount: 0, turnCount: 0, entries: [] };
  if (!Array.isArray(iceServers)) return empty;

  const entries: IceServerInfo[] = [];
  let stunCount = 0;
  let turnCount = 0;
  for (const server of iceServers) {
    if (!server || typeof server !== "object") continue;
    const record = server as { urls?: unknown; username?: unknown; credential?: unknown };
    const hasUsernameField = typeof record.username === "string" && record.username.length > 0;
    const hasCredentialField =
      typeof record.credential === "string" && record.credential.length > 0;
    const urls = Array.isArray(record.urls) ? record.urls : [record.urls];
    for (const raw of urls) {
      const info = parseIceServerUrl(raw);
      if (!info) continue;
      info.hasUsername = info.hasUsername || hasUsernameField;
      info.hasCredential = info.hasCredential || hasCredentialField;
      if (info.scheme === "stun" || info.scheme === "stuns") stunCount += 1;
      else if (info.scheme === "turn" || info.scheme === "turns") turnCount += 1;
      entries.push(info);
    }
  }
  return { received: entries.length > 0, stunCount, turnCount, entries };
}

/** Compact one-line summary for console: "received=YES stun=0 turn=2 hosts=turn1.example.com,...". */
export function iceServersSummaryLine(summary: IceServersSummary): string {
  const hosts = summary.entries.map((e) => `${e.scheme}:${e.hostname}${e.port ? `:${e.port}` : ""}`).join(",");
  return `received=${summary.received ? "YES" : "NO"} stun=${summary.stunCount} turn=${summary.turnCount}${hosts ? ` hosts=[${hosts}]` : ""}`;
}

// ---------------------------------------------------------------------------
// ICE candidate gathering (icecandidate events)
// ---------------------------------------------------------------------------

export interface GatheredCandidatesSummary {
  host: number;
  srflx: number;
  prflx: number;
  relay: number;
  total: number;
  /** Whether at least one relay candidate was gathered. */
  turnCandidate: boolean;
}

export function emptyGatheredCandidates(): GatheredCandidatesSummary {
  return { host: 0, srflx: 0, prflx: 0, relay: 0, total: 0, turnCandidate: false };
}

export function addGatheredCandidate(
  summary: GatheredCandidatesSummary,
  type: string | null | undefined
): GatheredCandidatesSummary {
  const next = { ...summary };
  if (type === "host") next.host += 1;
  else if (type === "srflx") next.srflx += 1;
  else if (type === "prflx") next.prflx += 1;
  else if (type === "relay") {
    next.relay += 1;
    next.turnCandidate = true;
  }
  next.total += 1;
  return next;
}

/** One-line summary: "host=2 srflx=1 prflx=0 relay=0 total=3 turnCandidate=NO". */
export function gatheredCandidatesLine(summary: GatheredCandidatesSummary): string {
  return `host=${summary.host} srflx=${summary.srflx} prflx=${summary.prflx} relay=${summary.relay} total=${summary.total} turnCandidate=${summary.turnCandidate ? "YES" : "NO"}`;
}

/**
 * Candidate type from an `icecandidate` event payload. Prefers the modern
 * `type`/`candidateType` fields, falls back to parsing the `typ <x>` token of
 * the raw candidate string. Never logs addresses or the candidate itself.
 */
export function candidateTypeOf(candidate: {
  type?: unknown;
  candidateType?: unknown;
  candidate?: unknown;
} | null | undefined): string | null {
  if (!candidate) return null;
  const typed = candidate.type ?? candidate.candidateType;
  if (typeof typed === "string" && typed.length > 0) return typed;
  if (typeof candidate.candidate === "string") {
    const m = candidate.candidate.match(/\styp\s([a-z0-9-]+)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** Protocol from an icecandidate event payload (udp | tcp) via property or raw parse. */
export function protocolOf(candidate: {
  protocol?: unknown;
  candidate?: unknown;
} | null | undefined): string | null {
  if (!candidate) return null;
  if (typeof candidate.protocol === "string" && candidate.protocol.length > 0) {
    return candidate.protocol;
  }
  if (typeof candidate.candidate === "string") {
    const m = candidate.candidate.match(/^candidate:\S+ \d+ (udp|tcp)/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** Address family (IPv4/IPv6) without ever exposing the address itself. */
export function addressFamilyOf(candidate: {
  addressFamily?: unknown;
  address?: unknown;
} | null | undefined): string | null {
  if (!candidate) return null;
  if (typeof candidate.addressFamily === "string" && candidate.addressFamily.length > 0) {
    return candidate.addressFamily;
  }
  if (typeof candidate.address === "string" && candidate.address.includes(":")) return "IPv6";
  return null;
}
