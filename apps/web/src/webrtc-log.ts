// Diagnostic logging for the WebRTC/PTT investigation. Everything in here is
// instrumentation only: it never changes PTT, negotiation, reconnect, heartbeat
// or room lifecycle behaviour. The logger is fully enabled in `vite dev` and in
// Electron (see main.ts's COMMANDER_LINK_DEBUG_LOGS), and opt-in for a packaged
// browser build via `?debug=webrtc`. When disabled every helper is a no-op so
// the shipped app pays nothing.

// Keep a bounded in-memory history of the last events so the "Copy diagnostics"
// report can include "Last events" without spamming the console permanently.
export const EVENT_HISTORY_LIMIT = 120;

export interface LogEvent {
  readonly time: string;
  readonly label: string;
  readonly detail: string;
}

interface WebrtcLogOptions {
  enabled?: boolean;
  consoleFn?: Pick<Console, "info" | "warn">;
}

const enabledInUrl = () =>
  new URLSearchParams(window.location.search).get("debug") === "webrtc";

// Gate: dev mode, `?debug=webrtc` in the URL, or a preload-set flag (Electron).
let logEnabled =
  (typeof import.meta.env !== "undefined" && Boolean(import.meta.env.DEV)) ||
  (typeof window !== "undefined" && enabledInUrl()) ||
  (typeof window !== "undefined" && Boolean((window as Window & { __commanderLinkDebug?: boolean }).__commanderLinkDebug));

let consoleFn: Pick<Console, "info" | "warn"> | undefined =
  typeof console !== "undefined" ? console : undefined;

const history: LogEvent[] = [];

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
    d.getMilliseconds()
  ).padStart(3, "0")}`;
}

function push(label: string, detail: string): void {
  const event: LogEvent = { time: nowStamp(), label, detail };
  history.push(event);
  if (history.length > EVENT_HISTORY_LIMIT) history.splice(0, history.length - EVENT_HISTORY_LIMIT);
  // Mirror onto globalThis so the transport's low-frequency snapshot timer can
  // copy it into the diagnostics report without importing this module.
  try {
    (globalThis as typeof globalThis & { __commanderLinkEvents?: LogEvent[] })
      .__commanderLinkEvents = history;
  } catch {
    // non-browser context (tests): ignore
  }
}

export function logWebrtc(label: string, detail: string, level: "info" | "warn" = "info"): void {
  if (!logEnabled) return;
  push(label, detail);
  if (consoleFn) {
    const line = `[webrtc] ${label} ${detail}`;
    if (level === "warn") consoleFn.warn(line);
    else consoleFn.info(line);
  }
}

/**
 * Enable the logger at runtime (used by the debug UI and by Electron preload
 * wiring). Returns the previous value so callers can decide what to do.
 */
export function setWebrtcLogEnabled(value: boolean): boolean {
  const previous = logEnabled;
  logEnabled = value;
  if (value && typeof window !== "undefined") {
    (window as Window & { __commanderLinkDebug?: boolean }).__commanderLinkDebug = true;
  }
  return previous;
}

export function isWebrtcLogEnabled(): boolean {
  return logEnabled;
}

/** Snapshot of a live WebRTC state for a single peer. */
export function pcStateOf(pc: {
  connectionState?: string;
  iceConnectionState?: string;
  iceGatheringState?: string;
  signalingState?: string;
} | null | undefined): string {
  if (!pc) return "";
  return [
    pc.connectionState ?? "?",
    pc.iceConnectionState ?? "?",
    pc.iceGatheringState ?? "?",
    pc.signalingState ?? "?",
  ].join(" ");
}

/** Track identity + state; deliberately excludes any device label or id of the
 * source (no privacy leak, and the SDK already exposes track ids on events). */
export function trackStateOf(track: MediaStreamTrack | null | undefined): string {
  if (!track) return "no-track";
  return `${track.kind} id=${track.id} enabled=${track.enabled} muted=${track.muted} readyState=${track.readyState}`;
}

/**
 * Plain-text diagnostics report for bug reports / the Copy button. Excludes all
 * tokens, credentials, TURN passwords, and truncates the room id.
 */
export function formatDiagnosticsReport(input: {
  client: string;
  platform: string;
  roomId: string;
  channel: string;
  localPeerId: string;
  state: string;
  iceServers?: {
    received: boolean;
    stunCount: number;
    turnCount: number;
    fallbackApplied: boolean;
    forceRelay: boolean;
    entries: Array<{
      scheme: string;
      hostname: string;
      port: string | null;
      transport: string | null;
      hasUsername: boolean;
      hasCredential: boolean;
    }>;
  };
  peers: Array<{
    name: string;
    id: string;
    connectionState: string;
    iceConnectionState: string;
    signalingState: string;
    candidateType: string | null;
    localCandidateType: string | null;
    remoteCandidateType: string | null;
    protocol: string | null;
    rttMs: number | null;
    bytesSent: number | null;
    bytesReceived: number | null;
    packetsSent: number | null;
    packetsReceived: number | null;
    audioTrackState: string;
    audioMuted: boolean | null;
    audioEnabled: boolean | null;
    gathered?: string;
    turnCandidateAvailable?: boolean;
  }>;
  history: readonly LogEvent[];
}): string {
  const lines: string[] = [];
  lines.push("Commander Link WebRTC Diagnostics");
  lines.push("");
  lines.push("Client:");
  lines.push(`  ${input.client}`);
  lines.push("platform:");
  lines.push(`  ${input.platform}`);
  lines.push("");
  lines.push("Room:");
  lines.push(`  ${input.roomId.length > 14 ? `${input.roomId.slice(0, 6)}…${input.roomId.slice(-4)}` : input.roomId}`);
  lines.push("channel:");
  lines.push(`  ${input.channel}`);
  lines.push("localPeerId:");
  lines.push(`  ${input.localPeerId}`);
  lines.push("state:");
  lines.push(`  ${input.state}`);
  lines.push("");
  const ice = input.iceServers;
  if (ice) {
    lines.push("Metered ICE configuration (welcome):");
    lines.push(`  TURN configuration received: ${ice.received ? "YES" : "NO"}`);
    lines.push(`  Open Relay fallback applied: ${ice.fallbackApplied ? "YES" : "NO"}`);
    lines.push(`  forceRelay (debug): ${ice.forceRelay ? "YES" : "NO"}`);
    lines.push(`  STUN server count: ${ice.stunCount}`);
    lines.push(`  TURN/TURNS server count: ${ice.turnCount}`);
    for (const entry of ice.entries) {
      const port = entry.port ? `:${entry.port}` : "";
      const transport = entry.transport ? `?transport=${entry.transport}` : "";
      const creds = entry.hasUsername || entry.hasCredential ? " (credentials present, not shown)" : "";
      lines.push(`  - ${entry.scheme}:${entry.hostname}${port}${transport}${creds}`);
    }
    lines.push("");
  }
  for (const p of input.peers) {
    lines.push(`Peer: ${p.name} (${p.id.slice(0, 8)}…)`);
    lines.push(`  connectionState: ${p.connectionState}`);
    lines.push(`  iceConnectionState: ${p.iceConnectionState}`);
    lines.push(`  signalingState: ${p.signalingState}`);
    lines.push(`  selectedCandidateType: ${p.candidateType ?? "n/a"}`);
    lines.push(`  selected ICE pair:`);
    lines.push(`    localCandidateType: ${p.localCandidateType ?? "n/a"}`);
    lines.push(`    remoteCandidateType: ${p.remoteCandidateType ?? "n/a"}`);
    lines.push(`    protocol: ${p.protocol ?? "n/a"}`);
    lines.push(`  RTT: ${p.rttMs !== null ? `${p.rttMs} ms` : "n/a"}`);
    lines.push(`  bytesSent: ${p.bytesSent ?? "n/a"}`);
    lines.push(`  bytesReceived: ${p.bytesReceived ?? "n/a"}`);
    lines.push(`  packetsSent: ${p.packetsSent ?? "n/a"}`);
    lines.push(`  packetsReceived: ${p.packetsReceived ?? "n/a"}`);
    lines.push(`  ICE candidates gathered: ${p.gathered ?? "n/a"}`);
    lines.push(`  TURN candidate available: ${p.turnCandidateAvailable === undefined ? "n/a" : p.turnCandidateAvailable ? "YES" : "NO"}`);
    lines.push(`  audioTrack: ${p.audioTrackState}`);
    lines.push(`  audioEnabled: ${p.audioEnabled === null ? "n/a" : String(p.audioEnabled)}`);
    lines.push(`  audioMuted: ${p.audioMuted === null ? "n/a" : String(p.audioMuted)}`);
    lines.push("");
  }
  lines.push("Last events:");
  for (const ev of input.history) {
    lines.push(`  ${ev.time} ${ev.label} ${ev.detail}`);
  }
  return lines.join("\n");
}

export { logEnabled as webrtcLogEnabled };
