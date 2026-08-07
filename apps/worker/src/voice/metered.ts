import { channelForRoom } from "@commander-link/core";
import { VoiceBackendError, type VoiceBackend, type VoiceSessionToken } from "./backend";

export interface MeteredRealtimeConfig {
  /** Metered Realtime key id (`sk_id_…`) — server secret, never shipped to clients. */
  keyId: string;
  /** Metered Realtime signing secret (`sk_secret_…`) — server secret. */
  secretKey: string;
  tokenTtlSeconds: number;
}

/**
 * Metered Realtime Messaging implementation of {@link VoiceBackend}. This is
 * the ONLY place that knows about Metered token-minting endpoints and the
 * secret key pair. There is deliberately no room provisioning or deletion:
 * Realtime channels are cheap and exist by name, so a Commander Link room maps
 * one-to-one to a channel and needs no Video Room lifecycle.
 *
 * Tokens are minted via the official REST API (`POST https://rms.metered.ca/v1/tokens`)
 * with the `sk_id:sk_secret` pair as Bearer auth. The minted JWT is scoped to
 * exactly one Commander Link channel and a short expiry. Metered TURN credentials
 * are auto-injected by the Realtime service into the welcome message when the
 * key's "Auto-inject TURN" toggle is on (default) — nothing secret leaves the
 * Worker, and no TURN credentials are hardcoded anywhere in the client.
 */
export class MeteredRealtimeVoiceBackend implements VoiceBackend {
  constructor(private readonly config: MeteredRealtimeConfig) {}

  async createAccessToken(roomId: string, peerId: string, displayName: string): Promise<VoiceSessionToken> {
    // Fail with a clear, safe reason when the secrets are missing or still
    // placeholder — this is the common "I restarted but nothing changed" case.
    const keyId = this.config.keyId?.trim() ?? "";
    const secretKey = this.config.secretKey?.trim() ?? "";
    if (!keyId || !secretKey) {
      throw new VoiceBackendError(
        "Metered Realtime credentials missing (set METERED_REALTIME_KEY_ID / METERED_REALTIME_SECRET)",
        "missing_credentials"
      );
    }
    if (keyId.includes("replace-me") || secretKey.includes("replace-me")) {
      throw new VoiceBackendError(
        "Metered Realtime credentials are placeholder values in .dev.vars",
        "placeholder_credentials"
      );
    }

    const channel = channelForRoom(roomId);

    let response: Response;
    try {
      response = await fetch("https://rms.metered.ca/v1/tokens", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keyId}:${secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          peerId,
          channels: [channel],
          permissions: ["publish", "subscribe", "presence", "send"],
          expiresInSec: this.config.tokenTtlSeconds,
          peerMetadata: { username: displayName },
        }),
      });
    } catch (err) {
      throw new VoiceBackendError(
        `Metered token minting unreachable: ${(err as Error).message}`,
        "provider_unreachable"
      );
    }

    if (!response.ok) {
      // Surface the server's machine-readable error (e.g. `unauthorized`,
      // `channel_not_authorized`, `action_not_permitted`, `invalid_request`) so
      // the Worker can report why minting failed. The body is safe to forward —
      // it contains no credentials.
      let code = `http_${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === "string" && payload.error.length > 0) {
          code = payload.error;
        }
      } catch {
        // Non-JSON error body; keep the HTTP-status code.
      }
      throw new VoiceBackendError(
        `Metered token minting HTTP ${response.status} (${code})`,
        code
      );
    }

    const payload: unknown = await response.json();
    const record = payload as { token?: unknown; expiresAt?: unknown };
    if (typeof record.token !== "string" || record.token.length === 0) {
      throw new VoiceBackendError("Metered returned no token", "empty_token");
    }
    if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt)) {
      throw new VoiceBackendError("Metered returned no token expiry", "empty_expiry");
    }

    return { token: record.token, channel, expiresAt: record.expiresAt };
  }
}
