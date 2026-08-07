import type { VoiceBackend } from "./backend";
import { MeteredRealtimeVoiceBackend } from "./metered";

export type { VoiceBackend, VoiceSessionToken } from "./backend";

// Config the active backend needs. The Worker's Env satisfies this structurally,
// so neither the Worker nor the Durable Object references a concrete provider.
export interface VoiceBackendEnv {
  METERED_REALTIME_KEY_ID: string;
  METERED_REALTIME_SECRET: string;
  TOKEN_TTL_SECONDS: string;
}

/** Single place that selects the concrete voice provider. */
export function createVoiceBackend(env: VoiceBackendEnv): VoiceBackend {
  return new MeteredRealtimeVoiceBackend({
    keyId: env.METERED_REALTIME_KEY_ID,
    secretKey: env.METERED_REALTIME_SECRET,
    tokenTtlSeconds: Number.parseInt(env.TOKEN_TTL_SECONDS, 10) || 3_600,
  });
}
