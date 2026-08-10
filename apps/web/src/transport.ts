// Provider-independent voice transport boundary. The React UI (and the shared
// PTT controller) depend ONLY on this interface — never on MeteredPeer or any
// concrete media provider. Metered-specific implementation lives in
// `./connection.ts` (MeteredRealtimeTransport).

import type { JoinRoomResponse } from "@commander-link/core";

/** Transport session handed to the client by the Worker join endpoint. */
export type VoiceSession = JoinRoomResponse;

export interface PeerView {
  id: string;
  name: string;
  volume: number; // 0..1, local playback only
  /** Per-peer WebRTC connection state when known: idle | connecting | connected | reconnecting | closed. */
  connectionState?: string;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface ConnectionCallbacks {
  onStatus(status: ConnectionStatus): void;
  onPeers(peers: PeerView[]): void;
  onActiveSpeaker(name: string | null): void;
  onSpeakerLevels(levels: Array<{ participantId: string; level: number; speaking: boolean; lastSpokeAt: number }>): void;
  onError(message: string): void;
  onReconnect(): void;
}

export interface TransportDiagnosticsPeer {
  id: string;
  name: string;
  /** RemotePeer connection state: idle | connecting | connected | reconnecting | closed. */
  state: string;
  /** Underlying RTCPeerConnection.connectionState when known. */
  connectionState: string;
  /** Underlying RTCPeerConnection.iceConnectionState. */
  iceConnectionState: string;
  /** Underlying RTCPeerConnection.signalingState when known. */
  signalingState: string;
  /** Selected candidate type when available: host | srflx | relay | null. */
  candidateType: string | null;
  /** Local side of the selected ICE candidate pair (host | srflx | prflx | relay). */
  localCandidateType: string | null;
  /** Remote side of the selected ICE candidate pair (host | srflx | prflx | relay). */
  remoteCandidateType: string | null;
  /** Selected pair protocol: udp | tcp | null. */
  protocol: string | null;
  /** Selected pair currentRoundTripTime in ms, or null. */
  rttMs: number | null;
  /** Aggregate audio bytes sent (outbound-rtp), or null when no RTP yet. */
  bytesSent: number | null;
  /** Aggregate audio bytes received (inbound-rtp), or null when no RTP yet. */
  bytesReceived: number | null;
  /** Aggregate audio packets sent, or null. */
  packetsSent: number | null;
  /** Aggregate audio packets received, or null. */
  packetsReceived: number | null;
  /** Remote audio track snapshot for this peer (kind/readyState), or null. */
  audioTrackState: string | null;
  /** Remote audio track muted flag when known, else null. */
  audioMuted: boolean | null;
  /** Remote audio track enabled flag when known, else null. */
  audioEnabled: boolean | null;
  /** Gathered-candidate summary line for this peer (host/srflx/prflx/relay counts). */
  gathered: string;
  gatheredHost: number;
  gatheredSrflx: number;
  gatheredPrflx: number;
  gatheredRelay: number;
  gatheredTotal: number;
  /** Whether at least one relay (TURN) candidate was gathered for this peer. */
  turnCandidateAvailable: boolean;
}

export interface IceServerDiagEntry {
  scheme: string;
  hostname: string;
  port: string | null;
  transport: "udp" | "tcp" | null;
  hasUsername: boolean;
  hasCredential: boolean;
}

export interface IceServersDiag {
  /** Whether the Metered welcome delivered any parseable iceServers entry. */
  received: boolean;
  stunCount: number;
  turnCount: number;
  /** Sanitized entries — scheme/hostname/port/transport only, no credentials. */
  entries: IceServerDiagEntry[];
}

export interface TransportDiagnostics {
  roomId: string;
  channel: string;
  localPeerId: string | null;
  /** MeteredPeer lifecycle state: idle | joining | joined | reconnecting | leaving | closed. */
  state: string;
  remotePeers: TransportDiagnosticsPeer[];
  /** Debug-mode only: recent instrumented events (PTT, ICE, negotiation, tracks). */
  events?: Array<{ time: string; label: string; detail: string }>;
  /** Sanitized ICE server configuration received from the Metered welcome. */
  iceServers?: IceServersDiag;
}

/**
 * The abstraction every provider must implement. PTT is hold-to-talk only:
 * `transmit()` while a key/button is held, `mute()` on release. Every failure
 * path must fail closed to muted.
 */
export interface VoiceTransport {
  connect(session: VoiceSession, displayName: string): Promise<void>;
  disconnect(): Promise<void>;

  transmit(): Promise<boolean>;
  mute(): Promise<void>;

  setVolume(peerId: string, volume: number): void;

  /** Development-only diagnostics. Never returns tokens or credentials. */
  getDiagnostics(): Promise<TransportDiagnostics>;
}
