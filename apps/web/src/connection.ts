import type { JoinRoomResponse } from "@commander-link/core";
import type {
  MeteredMeeting,
  MeteredParticipant,
  MeteredTrackItem,
} from "./metered";
import {
  AudioLevelMonitor,
  DEFAULT_AUDIO_LEVEL_CONFIG,
  type SpeakerLevel,
} from "./audio-level";

export interface PeerView {
  id: string;
  name: string;
  volume: number; // 0..1, local playback only
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
  onSpeakerLevels(levels: SpeakerLevel[]): void;
  onError(message: string): void;
  onReconnect(): void;
}

function participantId(p: MeteredParticipant): string {
  return p._id ?? "";
}

function participantName(p: MeteredParticipant): string {
  return p.name ?? "Unbekannt";
}

/**
 * Wraps the Metered Video SDK meeting. Audio-only, starts muted, and exposes
 * transmit()/mute() for the shared push-to-talk controller. Remote streams are
 * attached to per-peer <audio> elements so each peer can have its own volume.
 */
export class RoomConnection {
  private meeting: MeteredMeeting | null = null;
  private audioStarted = false;
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private readonly volumes = new Map<string, number>();
  private participants: MeteredParticipant[] = [];
  private readonly sink: HTMLElement;
  private readonly monitor: AudioLevelMonitor;
  private localParticipantId = "";

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
    return this.meeting !== null && this.audioStarted;
  }

  async connect(session: JoinRoomResponse, displayName: string): Promise<void> {
    if (typeof window.Metered === "undefined") {
      throw new Error("Metered SDK nicht geladen (Netzwerk/Adblocker prüfen).");
    }
    this.callbacks.onStatus("connecting");
    const meeting = new window.Metered.Meeting();
    this.meeting = meeting;

    meeting.on("stateChanged", (state) => {
      if (state === "joined" || state === "reconnect_success") {
        this.callbacks.onStatus("connected");
      } else if (state === "network_connection_lost") {
        this.callbacks.onStatus("reconnecting");
      } else if (state === "not_joined" || state === "terminated") {
        this.callbacks.onStatus("disconnected");
      }
      if (state === "reconnect_success") this.callbacks.onReconnect();
    });

    meeting.on("onlineParticipants", (list) => {
      this.participants = list ?? [];
      this.syncParticipantNames();
      this.emitPeers();
    });
    meeting.on("participantJoined", () => {
      this.syncParticipantNames();
      this.emitPeers();
    });
    meeting.on("participantLeft", (p) => {
      const id = participantId(p);
      if (id) this.monitor.removeParticipant(id);
      this.emitPeers();
    });
    meeting.on("activeSpeaker", (info) => this.callbacks.onActiveSpeaker(info?.name ?? null));

    meeting.on("remoteTrackStarted", (item: MeteredTrackItem) => {
      if (item.type !== "audio") return;
      this.attachRemoteAudio(item);
    });
    meeting.on("remoteTrackStopped", (item: MeteredTrackItem) => {
      this.detachRemoteAudio(item.streamId);
    });

    meeting.on("localTrackStarted", (item: MeteredTrackItem) => {
      if (item.type !== "audio") return;
      const name = this.resolveParticipantName(this.localParticipantId) || displayName;
      this.monitor.addTrack(item.streamId, this.localParticipantId, item.track, name);
    });

    meeting.on("localTrackStopped", (item: MeteredTrackItem) => {
      if (item.type !== "audio") return;
      this.monitor.removeTrack(item.streamId);
      this.monitor.resetLevel(this.localParticipantId);
    });

    const info = await meeting.join({
      roomURL: session.roomUrl,
      name: displayName,
      accessToken: session.token,
      receiveAudioStreamType: "only_individual",
      receiveVideoStreamType: "none",
    });
    this.localParticipantId = info.participantSessionId ?? "";

    // Acquire the microphone once, then immediately mute. We keep the producer
    // alive and only toggle mute for PTT, so peers stay connected.
    await meeting.startAudio();
    this.audioStarted = true;
    await meeting.muteLocalAudio();

    this.participants = meeting.getOnlineParticipants();
    this.syncParticipantNames();
    this.emitPeers();
    this.callbacks.onStatus("connected");
  }

  /** Fail-closed: any error while unmuting is reported and leaves the mic muted. */
  async transmit(): Promise<boolean> {
    if (!this.meeting || !this.audioStarted) return false;
    try {
      await this.meeting.unmuteLocalAudio();
      return true;
    } catch (err) {
      this.callbacks.onError(`PTT unmute fehlgeschlagen: ${(err as Error).message}`);
      await this.mute();
      return false;
    }
  }

  async mute(): Promise<void> {
    if (!this.meeting || !this.audioStarted) return;
    try {
      await this.meeting.muteLocalAudio();
    } catch (err) {
      this.callbacks.onError(`PTT mute fehlgeschlagen: ${(err as Error).message}`);
    }
  }

  setVolume(peerId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volumes.set(peerId, clamped);
    const el = this.audioElements.get(peerId);
    if (el) el.volume = clamped;
    this.emitPeers();
  }

  async disconnect(): Promise<void> {
    const meeting = this.meeting;
    this.meeting = null;
    this.audioStarted = false;
    for (const id of [...this.audioElements.keys()]) this.detachRemoteAudio(id);
    this.monitor.dispose();
    this.participants = [];
    this.localParticipantId = "";
    this.emitPeers();
    if (meeting) {
      try {
        await meeting.leaveMeeting();
      } catch {
        // best effort
      }
    }
    this.callbacks.onStatus("disconnected");
  }

  private attachRemoteAudio(item: MeteredTrackItem): void {
    const peerId = item.participantSessionId ?? item.streamId;
    this.detachRemoteAudio(peerId);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = new MediaStream([item.track]);
    audio.volume = this.volumes.get(peerId) ?? 1;
    this.audioElements.set(peerId, audio);
    this.sink.append(audio);
    void audio.play().catch(() => {});

    const name = this.resolveParticipantName(peerId);
    this.monitor.addTrack(item.streamId, peerId, item.track, name);
  }

  private detachRemoteAudio(key: string): void {
    // key may be a peerId or a streamId; handle both.
    const el = this.audioElements.get(key);
    if (el) {
      el.srcObject = null;
      el.remove();
      this.audioElements.delete(key);
    }
    this.monitor.removeTrack(key);
  }

  private syncParticipantNames(): void {
    for (const p of this.participants) {
      const id = participantId(p);
      if (id) this.monitor.setParticipantName(id, participantName(p));
    }
  }

  private resolveParticipantName(peerId: string): string {
    const p = this.participants.find((p) => participantId(p) === peerId);
    return p ? participantName(p) : "";
  }

  private emitPeers(): void {
    const peers: PeerView[] = this.participants.map((p) => {
      const id = participantId(p);
      return { id, name: participantName(p), volume: this.volumes.get(id) ?? 1 };
    });
    this.callbacks.onPeers(peers);
  }
}
