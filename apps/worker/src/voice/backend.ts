// Provider-agnostic voice transport abstraction. Commander Link owns rooms,
// admission, TTL, heartbeat and cleanup; a VoiceBackend only mints transport
// credentials. With Metered Realtime Messaging there is nothing to provision or
// delete — a room is just a channel name — so the interface is a single token
// mint. The Worker and Durable Object depend on this interface only — never on
// a concrete provider.

export interface VoiceSessionToken {
  /** Short-lived, channel-scoped JWT minted by the provider. */
  token: string;
  /** The provider channel this token authorizes (deterministic from the room id). */
  channel: string;
  /** Unix-seconds expiry reported by the provider. */
  expiresAt: number;
}

export interface VoiceBackend {
  /** Mint a short-lived, channel-scoped access token for one participant. */
  createAccessToken(roomId: string, peerId: string, displayName: string): Promise<VoiceSessionToken>;
}

/**
 * Error thrown by a VoiceBackend. The `code` is a short, safe, machine-readable
 * reason (e.g. `unauthorized`, `channel_not_authorized`, `action_not_permitted`,
 * `provider_unreachable`) that the Worker may surface to clients and logs. It
 * never contains tokens or credentials.
 */
export class VoiceBackendError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "VoiceBackendError";
  }
}
