export interface AudioLevelConfig {
  readonly fftSize: number;
  readonly smoothingTimeConstant: number;
  readonly minDb: number;
  readonly maxDb: number;
  readonly attackWeight: number;
  readonly decayWeight: number;
  readonly floorThreshold: number;
  readonly speakingThreshold: number;
  readonly speakingHangoverMs: number;
  readonly uiUpdateIntervalMs: number;
}

export const DEFAULT_AUDIO_LEVEL_CONFIG: AudioLevelConfig = {
  fftSize: 512,
  smoothingTimeConstant: 0.15,
  minDb: -60,
  maxDb: -6,
  attackWeight: 0.7,
  decayWeight: 0.12,
  floorThreshold: 0.8,
  speakingThreshold: 7,
  speakingHangoverMs: 380,
  uiUpdateIntervalMs: 50,
};

export function rmsToPercent(
  samples: Float32Array<ArrayBufferLike>,
  minDb = -60,
  maxDb = -6,
): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0.00001) return 0;
  const db = 20 * Math.log10(rms);
  const norm = (db - minDb) / (maxDb - minDb);
  return Math.max(0, Math.min(100, norm * 100));
}

export function smoothLevel(
  current: number,
  instant: number,
  config: Pick<AudioLevelConfig, "attackWeight" | "decayWeight" | "floorThreshold">,
): number {
  let level: number;
  if (instant > current) {
    level = current * (1 - config.attackWeight) + instant * config.attackWeight;
  } else {
    level = current * (1 - config.decayWeight) + instant * config.decayWeight;
  }
  if (level < config.floorThreshold) level = 0;
  return level;
}

export interface SpeakerLevel {
  readonly participantId: string;
  readonly level: number;
  readonly speaking: boolean;
  readonly lastSpokeAt: number;
}

export type SpeakerLevelsCallback = (levels: SpeakerLevel[]) => void;

interface InternalLevelState {
  level: number;
  lastSpokeAt: number;
}

interface AnalyserEntry {
  readonly participantId: string;
  readonly source: MediaStreamAudioSourceNode;
  readonly analyser: AnalyserNode;
  readonly buffer: Float32Array<ArrayBufferLike>;
}

export class AudioLevelMonitor {
  private audioContext: AudioContext | null = null;
  private readonly analysers = new Map<string, AnalyserEntry>();
  private readonly levelStates = new Map<string, InternalLevelState>();
  private readonly participantNames = new Map<string, string>();
  private rafId: number | null = null;
  private lastUiEmit = 0;
  private disposed = false;

  constructor(
    private readonly config: AudioLevelConfig = DEFAULT_AUDIO_LEVEL_CONFIG,
    private readonly callback?: SpeakerLevelsCallback,
  ) {}

  private ensureAudioContext(): AudioContext | null {
    if (this.disposed) return null;
    if (!this.audioContext) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.audioContext = new Ctx();
    }
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  addTrack(streamId: string, participantId: string, track: MediaStreamTrack, name?: string): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    this.removeTrack(streamId);

    if (name) this.participantNames.set(participantId, name);

    const stream = new MediaStream([track]);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = this.config.fftSize;
    analyser.smoothingTimeConstant = this.config.smoothingTimeConstant;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    this.analysers.set(streamId, { participantId, source, analyser, buffer });

    if (!this.levelStates.has(participantId)) {
      this.levelStates.set(participantId, { level: 0, lastSpokeAt: 0 });
    }

    if (this.rafId === null) this.startLoop();
  }

  removeTrack(streamId: string): void {
    const entry = this.analysers.get(streamId);
    if (!entry) return;
    try {
      entry.source.disconnect();
    } catch {
      // no-op
    }
    this.analysers.delete(streamId);

    if (this.analysers.size === 0) {
      for (const state of this.levelStates.values()) {
        state.level = 0;
      }
      this.stopLoop();
      this.emitLevelsNow();
    }
  }

  setParticipantName(participantId: string, name: string): void {
    this.participantNames.set(participantId, name);
  }

  removeParticipant(participantId: string): void {
    this.levelStates.delete(participantId);
    this.participantNames.delete(participantId);
  }

  resetLevel(participantId: string): void {
    const state = this.levelStates.get(participantId);
    if (state) {
      state.level = 0;
      state.lastSpokeAt = 0;
    }
  }

  private startLoop(): void {
    if (this.rafId !== null || this.disposed) return;
    const tick = () => {
      if (this.disposed) return;
      this.processFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private processFrame(): void {
    const now = Date.now();
    let changed = false;
    let speakingChanged = false;

    for (const entry of this.analysers.values()) {
      entry.analyser.getFloatTimeDomainData(entry.buffer as Float32Array<ArrayBuffer>);
      const instant = rmsToPercent(entry.buffer, this.config.minDb, this.config.maxDb);
      const state = this.levelStates.get(entry.participantId);
      if (!state) continue;

      const wasSpeaking = now - state.lastSpokeAt < this.config.speakingHangoverMs;

      state.level = smoothLevel(state.level, instant, this.config);

      if (state.level > this.config.speakingThreshold) {
        state.lastSpokeAt = now;
      }

      const isSpeaking = now - state.lastSpokeAt < this.config.speakingHangoverMs;
      if (wasSpeaking !== isSpeaking) speakingChanged = true;
      changed = true;
    }

    if (changed && this.callback) {
      const elapsed = now - this.lastUiEmit;
      if (elapsed >= this.config.uiUpdateIntervalMs || speakingChanged) {
        this.lastUiEmit = now;
        this.emitLevels(now);
      }
    }
  }

  private emitLevels(now: number): void {
    if (!this.callback) return;
    const hangover = this.config.speakingHangoverMs;
    const levels: SpeakerLevel[] = [];
    for (const [pid, state] of this.levelStates) {
      levels.push({
        participantId: pid,
        level: Math.round(state.level * 10) / 10,
        speaking: now - state.lastSpokeAt < hangover,
        lastSpokeAt: state.lastSpokeAt,
      });
    }
    this.callback(levels);
  }

  private emitLevelsNow(): void {
    if (!this.callback) return;
    this.lastUiEmit = Date.now();
    this.emitLevels(this.lastUiEmit);
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    for (const entry of this.analysers.values()) {
      try {
        entry.source.disconnect();
      } catch {
        // no-op
      }
    }
    this.analysers.clear();
    this.levelStates.clear();
    this.participantNames.clear();
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
