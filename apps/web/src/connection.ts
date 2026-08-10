// Metered Realtime implementation of the provider-independent VoiceTransport.
// Uses `@metered-ca/realtime`'s MeteredPeer for signalling, presence, SDP/ICE
// coordination, reconnect and auto-injected TURN. Commander Link still owns
// admission, identity, PTT, the peer roster and audio rendering.

import { ConsoleLogger, MeteredPeer, type RemotePeer } from "@metered-ca/realtime";
import { joinRoom } from "./api";
import {
  AudioLevelMonitor,
  DEFAULT_AUDIO_LEVEL_CONFIG,
  type SpeakerLevel,
} from "./audio-level";
import {
  candidatePairSummary,
  collectCandidatePair,
  type CandidatePairInfo,
} from "./diagnostics";
import {
  applyPeerJoined,
  applyPeerLeft,
  nameFromMetadata,
  toPeerViews,
  type RosterEntry,
} from "./peers";
import {
  isWebrtcLogEnabled,
  logWebrtc,
  pcStateOf,
  setWebrtcLogEnabled,
  trackStateOf,
  type LogEvent,
} from "./webrtc-log";
import type {
  ConnectionCallbacks,
  PeerView,
  TransportDiagnostics,
  TransportDiagnosticsPeer,
  VoiceSession,
  VoiceTransport,
} from "./transport";

// Diagnostic snapshot label types used by the low-frequency sampling.
export type SnapshotLabel =
  | "WEBRTC_CONNECTED"
  | "PTT_START"
  | "PTT_ACTIVE"
  | "PTT_STOP"
  | "CONNECTION_FAILURE";

export type PeerDestroyReason =
  | "manual-leave"
  | "heartbeat-timeout"
  | "connection-failed"
  | "ice-failed"
  | "remote-left"
  | "room-cleanup"
  | "application-shutdown"
  | "track-ended"
  | "unknown";

/** Track state readable synchronously; all fields are non-secret. */
interface TrackSnapshot {
  kind: string;
  id: string;
  enabled: boolean;
  muted: boolean;
  readyState: string;
}

function trackSnapshot(track: MediaStreamTrack | null | undefined): TrackSnapshot | null {
  if (!track) return null;
  return {
    kind: track.kind,
    id: track.id,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  };
}

/**
 * Audio-only peer-to-peer mesh over Metered Realtime Messaging.
 *
 * - One microphone MediaStream is acquired on join and kept alive; PTT only
 *   toggles `track.enabled` (silence), so the established PeerConnections are
 *   never renegotiated on every F8 press.
 * - Everyone starts muted; every failure path fails closed to muted.
 * - Remote audio is rendered via one per-peer <audio> element with its own volume.
 *
 * Everything under "WebRTC/PTT diagnostics" in this class is pure
 * instrumentation: it observes and logs, never changes negotiation, PTT,
 * reconnect, heartbeat or lifecycle behaviour.
 */
export class MeteredRealtimeTransport implements VoiceTransport {
  private peer: MeteredPeer | null = null;
  private session: VoiceSession | null = null;
  private displayName = "";
  private localStream: MediaStream | null = null;
  private localTrack: MediaStreamTrack | null = null;
  private audioReady = false;
  private disposed = false;

  private roster: RosterEntry[] = [];
  private volumes = new Map<string, number>();
  private remoteStates = new Map<string, string>();
  private remotePcs = new Map<string, unknown>();
  private remoteCandidatePairs = new Map<string, CandidatePairInfo>();
  private remoteAudioTrackState = new Map<string, string | null>();
  private remoteAudioMuted = new Map<string, boolean | null>();
  private remoteAudioEnabled = new Map<string, boolean | null>();
  private remoteDestroyed = new Set<string>();
  private remoteTracks = new Map<string, MediaStreamTrack>();
  private pendingActiveTimers: number[] = [];
  private cachedHistory: LogEvent[] = [];
  private historyTimer: number | null = null;
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
    this.localTrack = localTrack ?? null;
    if (localTrack) {
      localTrack.enabled = false;
      // Track lifecycle instrumentation — observes mute/unmute/ended only.
      localTrack.addEventListener("mute", () => {
        logWebrtc("TRACK_MUTE", `local ${trackStateOf(localTrack)}`, "warn");
      });
      localTrack.addEventListener("unmute", () => {
        logWebrtc("TRACK_UNMUTE", `local ${trackStateOf(localTrack)}`);
      });
      localTrack.addEventListener("ended", () => {
        logWebrtc("TRACK_ENDED", `local ${trackStateOf(localTrack)}`, "warn");
        this.logPeerDestroyAll("track-ended");
      });
      logWebrtc("TRACK_CREATED", `local ${trackStateOf(localTrack)}`);
    } else {
      logWebrtc("TRACK_CREATED", "local none (no audio track from getUserMedia)", "warn");
    }

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
    logWebrtc("WEBRTC_CONNECTED_SNAPSHOT", this.snapshotLine("connected"));
    void this.captureSnapshot("WEBRTC_CONNECTED");
    // Keep a bounded event history for the copy-diagnostics report (read by the
    // debug UI's polling). No console spam: it just refreshes an in-memory array.
    if (this.historyTimer === null && isWebrtcLogEnabled()) {
      this.historyTimer = window.setInterval(() => {
        this.cachedHistory = this.historySnapshot();
      }, 2000);
    }
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    const peer = this.peer;
    this.peer = null;
    this.audioReady = false;
    for (const timer of this.pendingActiveTimers) window.clearTimeout(timer);
    this.pendingActiveTimers = [];
    if (this.historyTimer !== null) {
      window.clearInterval(this.historyTimer);
      this.historyTimer = null;
    }
    this.logPeerDestroyAll("manual-leave");
    for (const id of [...this.audioElements.keys()]) this.detachRemoteAudio(id);
    this.roster = [];
    this.remoteStates.clear();
    this.remotePcs.clear();
    this.remoteCandidatePairs.clear();
    this.remoteAudioTrackState.clear();
    this.remoteAudioMuted.clear();
    this.remoteAudioEnabled.clear();
    this.remoteDestroyed.clear();
    this.remoteTracks.clear();
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
    logWebrtc("PTT_DOWN", this.pttStateLine("down", track));
    const snap = this.snapshotLine("ptt-down");
    logWebrtc("PTT_START_SNAPSHOT", snap);
    void this.captureSnapshot("PTT_START");
    // Delayed sample while PTT is active (~1.5s later) so the active-media
    // path (RTP counters, selected pair under load) is observable.
    const activeTimer = window.setTimeout(() => {
      if (this.disposed || !track.enabled) return;
      void this.captureSnapshot("PTT_ACTIVE");
    }, 1500);
    this.pendingActiveTimers.push(activeTimer);
    try {
      track.enabled = true;
      logWebrtc("TRACK_ENABLED", `local ${trackStateOf(track)}`);
      return true;
    } catch (err) {
      track.enabled = false;
      this.callbacks.onError(`PTT unmute fehlgeschlagen: ${(err as Error).message}`);
      logWebrtc("PTT_FAILED", `local ${trackStateOf(track)}`, "warn");
      return false;
    }
  }

  async mute(): Promise<void> {
    const track = this.localStream?.getAudioTracks()[0];
    if (track) {
      logWebrtc("PTT_UP", this.pttStateLine("up", track));
      const snap = this.snapshotLine("ptt-up");
      logWebrtc("PTT_STOP_SNAPSHOT", snap);
      void this.captureSnapshot("PTT_STOP");
      track.enabled = false;
      logWebrtc("TRACK_DISABLED", `local ${trackStateOf(track)}`);
    }
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
          connectionState?: string;
          iceConnectionState?: string;
          signalingState?: string;
          getStats?: () => Promise<unknown>;
        };
        const pair = await collectCandidatePair(pc);
        remotePeers.push({
          id: remote.id,
          name: nameFromMetadata(remote.metadata) || "Unbekannt",
          state: remote.state,
          connectionState: pc?.connectionState ?? "n/a",
          iceConnectionState: pc?.iceConnectionState ?? "n/a",
          signalingState: pc?.signalingState ?? "n/a",
          candidateType: pair.localCandidateType,
          localCandidateType: pair.localCandidateType,
          remoteCandidateType: pair.remoteCandidateType,
          protocol: pair.protocol,
          rttMs: pair.currentRoundTripTime,
          bytesSent: pair.bytesSent,
          bytesReceived: pair.bytesReceived,
          packetsSent: pair.packetsSent,
          packetsReceived: pair.packetsReceived,
          audioTrackState: this.remoteAudioTrackState.get(remote.id) ?? null,
          audioMuted: this.remoteAudioMuted.get(remote.id) ?? null,
          audioEnabled: this.remoteAudioEnabled.get(remote.id) ?? null,
        });
      }
    }
    return {
      roomId: this.session?.roomId ?? "",
      channel: this.session?.channel ?? "",
      localPeerId: peer?.peerId ?? null,
      state: peer?.state ?? "idle",
      remotePeers,
      events: this.snapshotHistory(),
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
      this.wireRemotePeer(remote, name);

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
      this.logPeerDestroy(remote.id, "remote-left");
      this.emitPeers();
    });

    peer.on("error", ({ err }) => {
      this.failClosedMute();
      this.callbacks.onError(err?.message ?? "Verbindungsfehler");
    });
  }

  // ---------------------------------------------------------------------------
  // WebRTC / PTT diagnostics (observation only)
  // ---------------------------------------------------------------------------

  private wireRemotePeer(remote: RemotePeer, displayName: string): void {
    const id = remote.id;

    // Observe the underlying RTCPeerConnection state transitions.
    const wirePc = () => {
      const pc = remote.pc as unknown as {
        connectionState?: string;
        iceConnectionState?: string;
        iceGatheringState?: string;
        signalingState?: string;
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
        getStats?: () => Promise<unknown>;
      } | null;
      if (!pc || pc === this.remotePcs.get(id)) return;
      this.remotePcs.set(id, pc);
      logWebrtc(
        "PEER_ATTACH",
        `[${this.peerLabel(id, displayName)}] initial ${pcStateOf(pc)}`
      );

      // ConnectionState transitions: new -> connecting -> connected -> disconnected -> failed -> closed.
      pc.addEventListener?.("connectionstatechange", () => {
        if (this.remotePcs.get(id) !== pc) return;
        const cs = pc.connectionState ?? "?";
        if (cs === "disconnected") {
          const t0 = Date.now();
          // Distinguish transient `disconnected` from terminal `failed`: sample
          // again after 1.5s. The SDK itself may recover or ICE-restart, which
          // lands as a fresh `connected`/`failed` state; this timer only logs.
          window.setTimeout(() => {
            if (this.disposed || this.remotePcs.get(id) !== pc) return;
            const nowCs = pc.connectionState ?? "?";
            if (nowCs === "disconnected") {
              logWebrtc(
                "ICE_DISCONNECTED_DURATION",
                `[${this.peerLabel(id, displayName)}] connectionState still disconnected after ${Date.now() - t0}ms`,
                "warn"
              );
            }
          }, 1500);
        }
        logWebrtc(
          "CONNECTION_STATE",
          `[${this.peerLabel(id, displayName)}] connectionState=${cs} ${pcStateOf(pc)}`
        );
        if (cs === "connected") {
          this.remoteStates.set(id, "connected");
          this.emitPeers();
        } else if (cs === "failed") {
          this.logPeerDestroy(id, "ice-failed");
        }
      });

      // IceConnectionState transitions: new -> checking -> connected -> completed -> disconnected -> failed -> closed.
      pc.addEventListener?.("iceconnectionstatechange", () => {
        if (this.remotePcs.get(id) !== pc) return;
        const ice = pc.iceConnectionState ?? "?";
        logWebrtc(
          "ICE_STATE",
          `[${this.peerLabel(id, displayName)}] iceConnectionState=${ice} ${pcStateOf(pc)}`
        );
        if (ice === "disconnected") {
          this.logPeerDestroy(id, "connection-failed");
        } else if (ice === "failed") {
          this.logPeerDestroy(id, "ice-failed");
        }
      });

      // IceGatheringState transitions: new -> gathering -> complete.
      pc.addEventListener?.("icegatheringstatechange", () => {
        if (this.remotePcs.get(id) !== pc) return;
        logWebrtc(
          "ICE_GATHERING_STATE",
          `[${this.peerLabel(id, displayName)}] iceGatheringState=${pc.iceGatheringState ?? "?"}`
        );
      });

      // SignalingState transitions (only fired on renegotiation).
      pc.addEventListener?.("signalingstatechange", () => {
        if (this.remotePcs.get(id) !== pc) return;
        logWebrtc(
          "SIGNALING_STATE",
          `[${this.peerLabel(id, displayName)}] signalingState=${pc.signalingState ?? "?"}`
        );
      });

      // Negotiation events: fires only when the app/SDK triggers renegotiation.
      pc.addEventListener?.("negotiationneeded", () => {
        if (this.remotePcs.get(id) !== pc) return;
        logWebrtc(
          "NEGOTIATION_NEEDED",
          `[${this.peerLabel(id, displayName)}] ${pcStateOf(pc)}`,
          "warn"
        );
      });

      // SDP/description flow — labels only, never the SDP payload.
      const sniffMethod = (
        proto: unknown,
        name: string,
        fn: unknown
      ): unknown => {
        return (...args: unknown[]) => {
          logWebrtc(
            "SDP_FLOW",
            `[${this.peerLabel(id, displayName)}] ${name}`
          );
          return (fn as (...a: unknown[]) => unknown).apply(proto, args);
        };
      };
      const proto = pc as unknown as Record<string, unknown>;
      if (typeof proto.createOffer === "function") {
        const orig = proto.createOffer as unknown;
        proto.createOffer = sniffMethod(proto, "createOffer", orig);
      }
      if (typeof proto.createAnswer === "function") {
        const orig = proto.createAnswer as unknown;
        proto.createAnswer = sniffMethod(proto, "createAnswer", orig);
      }
      if (typeof proto.setLocalDescription === "function") {
        const orig = proto.setLocalDescription as unknown;
        proto.setLocalDescription = sniffMethod(proto, "setLocalDescription", orig);
      }
      if (typeof proto.setRemoteDescription === "function") {
        const orig = proto.setRemoteDescription as unknown;
        proto.setRemoteDescription = sniffMethod(proto, "setRemoteDescription", orig);
      }
    };
    wirePc();
    // After a transient drop the SDK swaps the underlying PC; re-wire once.
    remote.on("connection-reset", () => {
      logWebrtc("PEER_RECONNECT", `[${this.peerLabel(id, displayName)}] PC swapped`);
      wirePc();
    });

    // Track lifecycle for the remote audio track.
    remote.on("track", ({ track }) => {
      this.remoteTracks.set(id, track);
      const update = () => {
        this.remoteAudioTrackState.set(id, `${track.kind}:${track.readyState}`);
        this.remoteAudioMuted.set(id, track.muted);
        this.remoteAudioEnabled.set(id, track.enabled);
      };
      update();
      track.addEventListener("mute", update);
      track.addEventListener("unmute", update);
      track.addEventListener("ended", () => {
        update();
        logWebrtc(
          "REMOTE_TRACK_ENDED",
          `[${this.peerLabel(id, displayName)}] remote track ${track.kind}:${track.readyState}`,
          "warn"
        );
      });
      logWebrtc(
        "REMOTE_TRACK",
        `[${this.peerLabel(id, displayName)}] remote track ${track.kind}:${track.readyState} muted=${track.muted} enabled=${track.enabled}`
      );
    });
    remote.on("stream-removed", () => {
      this.remoteAudioTrackState.set(id, null);
      this.remoteAudioMuted.set(id, null);
      this.remoteAudioEnabled.set(id, null);
    });
  }

  private peerLabel(id: string, displayName: string): string {
    return `${displayName} ${id.slice(0, 8)}`;
  }

  private pttStateLine(direction: "down" | "up", track: MediaStreamTrack): string {
    const peers = [...this.remotePcs.keys()]
      .map((peerId) => {
        const pc = this.remotePcs.get(peerId) as
          | { connectionState?: string; iceConnectionState?: string; signalingState?: string }
          | undefined;
        const name = this.roster.find((r) => r.id === peerId)?.name ?? "?";
        return `${name.slice(0, 10)}(${peerId.slice(0, 8)}):${pcStateOf(pc)}`;
      })
      .join(" | ");
    return `PTT_${direction.toUpperCase()} track=${trackStateOf(track)} peers=[${peers || "none"}]`;
  }

  private snapshotLine(context: string): string {
    const peers = [...this.remotePcs.keys()]
      .map((peerId) => {
        const pc = this.remotePcs.get(peerId) as
          | { connectionState?: string; iceConnectionState?: string; signalingState?: string }
          | undefined;
        const name = this.roster.find((r) => r.id === peerId)?.name ?? "?";
        const pair = this.remoteCandidatePairs.get(peerId);
        return `${name.slice(0, 10)}(${peerId.slice(0, 8)}) ${pcStateOf(pc)}${
          pair ? ` ${candidatePairSummary(pair)}` : ""
        }`;
      })
      .join(" | ");
    return `${context} localTrack=${this.localTrack ? trackStateOf(this.localTrack) : "none"} peers=[${peers || "none"}]`;
  }

  /** Capture a low-frequency snapshot of the selected candidate pair + RTP stats. */
  private async captureSnapshot(label: SnapshotLabel): Promise<void> {
    if (!isWebrtcLogEnabled()) return;
    const entries: string[] = [];
    const now = new Date().toISOString();
    for (const [peerId, pc] of this.remotePcs) {
      const name = this.roster.find((r) => r.id === peerId)?.name ?? "?";
      const pair = await collectCandidatePair(
        pc as { getStats?: () => Promise<unknown> }
      );
      this.remoteCandidatePairs.set(peerId, pair);
      entries.push(`${name.slice(0, 10)}(${peerId.slice(0, 8)}) ${candidatePairSummary(pair)}`);
    }
    const local = this.localTrack ? trackStateOf(this.localTrack) : "none";
    const line = entries.length > 0 ? entries.join(" | ") : "no-peers";
    logWebrtc(label, `${now} ${line} localTrack=${local}`);
  }

  private snapshotHistory(): Array<{ time: string; label: string; detail: string }> {
    return this.cachedHistory;
  }

  private historySnapshot(): LogEvent[] {
    try {
      const events = (globalThis as typeof globalThis & { __commanderLinkEvents?: LogEvent[] })
        .__commanderLinkEvents;
      return events && Array.isArray(events) ? [...events] : [];
    } catch {
      return [];
    }
  }

  private logPeerDestroy(peerId: string, reason: PeerDestroyReason): void {
    if (this.remoteDestroyed.has(peerId)) return;
    this.remoteDestroyed.add(peerId);
    const name = this.roster.find((r) => r.id === peerId)?.name ?? "?";
    logWebrtc(
      "PEER_DESTROY",
      `[${this.peerLabel(peerId, name)}] reason=${reason}`,
      "warn"
    );
  }

  private logPeerDestroyAll(reason: PeerDestroyReason): void {
    for (const peerId of [...this.remotePcs.keys()]) {
      this.logPeerDestroy(peerId, reason);
    }
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
    if (track) {
      if (track.enabled) {
        logWebrtc("TRACK_DISABLED_FAIL_CLOSED", `local ${trackStateOf(track)}`, "warn");
      }
      track.enabled = false;
    }
  }

  private stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        logWebrtc("TRACK_STOPPED", `local ${trackStateOf(t)}`, "warn");
        t.stop();
      });
      this.localStream = null;
      this.localTrack = null;
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
