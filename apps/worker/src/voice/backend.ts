// Provider-agnostic voice transport abstraction. Commander Link owns rooms,
// admission, TTL, heartbeat and cleanup; a VoiceBackend only provides media
// transport (token creation + WebRTC/TURN session). The Worker and Durable
// Object depend on this interface only — never on a concrete provider.

export interface VoiceSessionToken {
  /** Short-lived, room-scoped access token minted by the provider. */
  token: string;
  /** Opaque provider connection target the client passes back to its SDK. */
  roomUrl: string;
}

export interface VoiceBackend {
  /** Provision the transport session for a room (idempotent). */
  createSession(roomId: string): Promise<void>;
  /** Mint a room-scoped access token for one participant. */
  createAccessToken(roomId: string, displayName: string): Promise<VoiceSessionToken>;
  /** Tear down the transport session for a room (best effort). */
  deleteSession(roomId: string): Promise<void>;
}
