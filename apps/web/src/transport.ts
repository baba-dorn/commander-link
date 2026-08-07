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
  /** Underlying RTCPeerConnection.iceConnectionState. */
  iceConnectionState: string;
  /** Selected candidate type when available: host | srflx | relay | null. */
  candidateType: string | null;
}

export interface TransportDiagnostics {
  roomId: string;
  channel: string;
  localPeerId: string | null;
  /** MeteredPeer lifecycle state: idle | joining | joined | reconnecting | leaving | closed. */
  state: string;
  remotePeers: TransportDiagnosticsPeer[];
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
