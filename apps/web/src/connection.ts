// Metered Realtime implementation of the provider-independent VoiceTransport.
// Uses `@metered-ca/realtime`'s MeteredPeer for signalling, presence, SDP/ICE
// coordination, reconnect and auto-injected TURN. Commander Link still owns
// admission, identity, PTT, the peer roster and audio rendering.

import { ConsoleLogger, MeteredPeer } from "@metered-ca/realtime";
import { joinRoom } from "./api";
import {
  AudioLevelMonitor,
  DEFAULT_AUDIO_LEVEL_CONFIG,
  type SpeakerLevel,
} from "./audio-level";
import { collectCandidateType } from "./diagnostics";
import {
  applyPeerJoined,
  applyPeerLeft,
  nameFromMetadata,
  toPeerViews,
  type RosterEntry,
} from "./peers";
import type {
  ConnectionCallbacks,
  PeerView,
  TransportDiagnostics,
  TransportDiagnosticsPeer,
  VoiceSession,
  VoiceTransport,
} from "./transport";

/**
 * Audio-only peer-to-peer mesh over Metered Realtime Messaging.
 *
 * - One microphone MediaStream is acquired on join and kept alive; PTT only
 *   toggles `track.enabled` (silence), so the established PeerConnections are
 *   never renegotiated on every F8 press.
 * - Everyone starts muted; every failure path fails closed to muted.
 * - Remote audio is rendered via one per-peer <audio> element with its own volume.
 */
export class MeteredRealtimeTransport implements VoiceTransport {
  private peer: MeteredPeer | null = null;
  private session: VoiceSession | null = null;
  private displayName = "";
  private localStream: MediaStream | null = null;
  private audioReady = false;
  private disposed = false;

  private roster: RosterEntry[] = [];
  private volumes = new Map<string, number>();
  private remoteStates = new Map<string, string>();
  private localInfo: { id: string; name: string } | null = null;
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly remoteStreamIds = new Map<string, string>();
  private readonly sink: HTMLElement;
  private readonly monitor: AudioLevelMonitor;

  constructor(private readonly callbacks: ConnectionCallbacks) {
    this.sink = document.createElement("div");
    this.sink.setAttribute("aria-hidden", "true");
    this.sink.style.display = "none";
    document.body.append(this.sink);

    this.monitor = new AudioLevelMonitor(DEFAULT_AUDIO_LEVEL_CONFIG, (levels) => {
      this.callbacks.onSpeakerLevels(levels);
    });
  }

  get isConnected(): boolean {
    return this.peer !== null && this.audioReady;
  }

  async connect(session: VoiceSession, displayName: string): Promise<void> {
    this.disposed = false;
    this.session = session;
    this.displayName = displayName;
    this.callbacks.onStatus("connecting");

    // Acquire exactly one microphone stream, then start muted immediately.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      this.callbacks.onError(`Mikrofon nicht verfügbar: ${(err as Error).message}`);
      throw err;
    }
    this.localStream = stream;
    const localTrack = stream.getAudioTracks()[0];
    if (localTrack) localTrack.enabled = false;

    const peer = new MeteredPeer({
      // tokenProvider is re-invoked by the SDK on first connect AND every
      // reconnect, so JWTs (and any rotated TURN creds) stay fresh.
      tokenProvider: () => this.mintToken(),
      logger: import.meta.env.DEV ? ConsoleLogger : undefined,
    });
    this.peer = peer;
    this.wirePeerEvents(peer);

    try {
      // Attach before join so the audio track rides in the first SDP offer and
      // newcomers get it without a per-peer renegotiation cycle.
      peer.addStream(stream, { role: "voice", label: "microphone" });
      await peer.join(session.channel);
    } catch (err) {
      await this.teardownAfterFailedConnect();
      throw err;
    }

    const localId = peer.peerId ?? session.peerId;
    this.localInfo = { id: localId, name: displayName };
    if (localTrack) {
      this.monitor.addTrack(localTrack.id, localId, localTrack, displayName);
    }
    this.audioReady = true;
    this.emitPeers();
    this.callbacks.onStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    const peer = this.peer;
    this.peer = null;
    this.audioReady = false;
    for (const id of [...this.audioElements.keys()]) this.detachRemoteAudio(id);
    this.roster = [];
    this.remoteStates.clear();
    this.localInfo = null;
    this.session = null;
    this.monitor.dispose();
    if (peer) {
      try {
        await peer.close("left room");
      } catch {
        // best effort
      }
    }
    this.stopLocalStream();
    this.emitPeers();
    this.callbacks.onStatus("disconnected");
  }

  /** Fail-closed: any error while unmuting is reported and leaves the mic muted. */
  async transmit(): Promise<boolean> {
    if (!this.audioReady || !this.localStream || !this.peer) return false;
    const track = this.localStream.getAudioTracks()[0];
    if (!track) return false;
    try {
      track.enabled = true;
      return true;
    } catch (err) {
      track.enabled = false;
      this.callbacks.onError(`PTT unmute fehlgeschlagen: ${(err as Error).message}`);
      return false;
    }
  }

  async mute(): Promise<void> {
    const track = this.localStream?.getAudioTracks()[0];
    if (track) track.enabled = false;
  }

  setVolume(peerId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volumes.set(peerId, clamped);
    const el = this.audioElements.get(peerId);
    if (el) el.volume = clamped;
    this.emitPeers();
  }

  async getDiagnostics(): Promise<TransportDiagnostics> {
    const peer = this.peer;
    const remotePeers: TransportDiagnosticsPeer[] = [];
    if (peer) {
      for (const remote of peer.remotePeers) {
        const pc = remote.pc as unknown as {
          iceConnectionState?: string;
          getStats?: () => Promise<unknown>;
        };
        remotePeers.push({
          id: remote.id,
          name: nameFromMetadata(remote.metadata) || "Unbekannt",
          state: remote.state,
          iceConnectionState: pc?.iceConnectionState ?? "n/a",
          candidateType: await collectCandidateType(pc),
        });
      }
    }
    return {
      roomId: this.session?.roomId ?? "",
      channel: this.session?.channel ?? "",
      localPeerId: peer?.peerId ?? null,
      state: peer?.state ?? "idle",
      remotePeers,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async mintToken(): Promise<string> {
    const session = this.session;
    if (!session || this.disposed) throw new Error("Keine Session vorhanden");
    // Re-admission is idempotent: the Worker refreshes the existing lease for
    // this admissionId and mints a fresh short-lived JWT.
    const fresh = await joinRoom(session.roomId, this.displayName, session.admissionId);
    this.session = fresh;
    return fresh.realtimeToken;
  }

  private wirePeerEvents(peer: MeteredPeer): void {
    peer.on("state-change", ({ to }) => {
      if (to === "reconnecting") {
        this.failClosedMute();
        this.callbacks.onStatus("reconnecting");
        this.callbacks.onReconnect();
      } else if (to === "joined") {
        this.callbacks.onStatus("connected");
      } else if (to === "leaving" || to === "closed") {
        this.failClosedMute();
        this.callbacks.onStatus("disconnected");
      }
    });

    peer.on("joined", ({ peerId }) => {
      if (this.localInfo) return;
      this.localInfo = { id: peerId, name: this.displayName };
      this.emitPeers();
    });

    peer.on("peer-joined", ({ peer: remote }) => {
      const id = remote.id;
      const name = nameFromMetadata(remote.metadata) || "Unbekannt";
      this.roster = applyPeerJoined(this.roster, { id, name });
      this.remoteStates.set(id, remote.state);

      remote.on("stream-added", ({ stream }) => this.attachRemoteAudio(id, stream));
      remote.on("stream-removed", () => this.detachRemoteAudio(id));
      remote.on("state-change", ({ to }) => {
        this.remoteStates.set(id, to);
        this.emitPeers();
      });

      this.emitPeers();
    });

    peer.on("peer-left", ({ peer: remote }) => {
      this.detachRemoteAudio(remote.id);
      this.monitor.removeParticipant(remote.id);
      this.roster = applyPeerLeft(this.roster, remote.id);
      this.remoteStates.delete(remote.id);
      this.emitPeers();
    });

    peer.on("error", ({ err }) => {
      this.failClosedMute();
      this.callbacks.onError(err?.message ?? "Verbindungsfehler");
    });
  }

  private attachRemoteAudio(peerId: string, stream: MediaStream): void {
    this.detachRemoteAudio(peerId);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.volume = this.volumes.get(peerId) ?? 1;
    this.audioElements.set(peerId, audio);
    this.sink.append(audio);
    void audio.play().catch(() => {});

    const audioTrack = stream.getAudioTracks()[0];
    const entry = this.roster.find((r) => r.id === peerId);
    if (audioTrack) {
      this.remoteStreamIds.set(peerId, stream.id);
      this.monitor.addTrack(stream.id, peerId, audioTrack, entry?.name ?? "");
    }
  }

  private detachRemoteAudio(peerId: string): void {
    const el = this.audioElements.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioElements.delete(peerId);
    }
    const streamId = this.remoteStreamIds.get(peerId);
    if (streamId) {
      this.monitor.removeTrack(streamId);
      this.remoteStreamIds.delete(peerId);
    }
  }

  private failClosedMute(): void {
    const track = this.localStream?.getAudioTracks()[0];
    if (track) track.enabled = false;
  }

  private stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }

  private async teardownAfterFailedConnect(): Promise<void> {
    const peer = this.peer;
    this.peer = null;
    this.audioReady = false;
    if (peer) {
      try {
        await peer.close("join failed");
      } catch {
        // best effort
      }
    }
    this.stopLocalStream();
    this.callbacks.onStatus("disconnected");
  }

  private emitPeers(): void {
    const peers: PeerView[] = [];
    if (this.localInfo) {
      peers.push({
        id: this.localInfo.id,
        name: this.localInfo.name,
        volume: this.volumes.get(this.localInfo.id) ?? 1,
      });
    }
    for (const entry of toPeerViews(this.roster, this.volumes)) {
      peers.push({ ...entry, connectionState: this.remoteStates.get(entry.id) });
    }
    this.callbacks.onPeers(peers);
  }
}

/**
 * The only entry point the UI uses. Swapping in another provider (LiveKit,
 * coturn + custom signalling, …) means replacing this factory — the React UI
 * and PttController never see MeteredPeer directly.
 */
export function createVoiceTransport(callbacks: ConnectionCallbacks): VoiceTransport {
  return new MeteredRealtimeTransport(callbacks);
}

export type {
  ConnectionCallbacks,
  ConnectionStatus,
  PeerView,
  TransportDiagnostics,
  TransportDiagnosticsPeer,
  VoiceSession,
  VoiceTransport,
} from "./transport";
export type { SpeakerLevel } from "./audio-level";
