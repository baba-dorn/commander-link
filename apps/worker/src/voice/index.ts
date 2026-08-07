import type { VoiceBackend } from "./backend";
import { MeteredVoiceBackend } from "./metered";

export type { VoiceBackend, VoiceSessionToken } from "./backend";

// Config the active backend needs. The Worker's Env satisfies this structurally,
// so neither the Worker nor the Durable Object references a concrete provider.
export interface VoiceBackendEnv {
  METERED_APP_NAME: string;
  METERED_SECRET_KEY: string;
  MAX_ROOM_PEERS: string;
  ROOM_TTL_SECONDS: string;
}

/** Single place that selects the concrete voice provider. */
export function createVoiceBackend(env: VoiceBackendEnv): VoiceBackend {
  return new MeteredVoiceBackend({
    appName: env.METERED_APP_NAME,
    secretKey: env.METERED_SECRET_KEY,
    maxParticipants: Number.parseInt(env.MAX_ROOM_PEERS, 10) || 4,
    roomTtlSeconds: Number.parseInt(env.ROOM_TTL_SECONDS, 10) || 21_600,
  });
}
