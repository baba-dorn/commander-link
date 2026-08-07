import type { VoiceBackend, VoiceSessionToken } from "./backend";

export interface MeteredConfig {
  appName: string;
  secretKey: string;
  maxParticipants: number;
  roomTtlSeconds: number;
}

class MeteredError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Metered implementation of {@link VoiceBackend}. This is the ONLY place that
 * knows about Metered REST endpoints, room configuration and the secret key.
 * Swapping providers (LiveKit, coturn, mediasoup, …) means replacing this class.
 */
export class MeteredVoiceBackend implements VoiceBackend {
  constructor(private readonly config: MeteredConfig) {}

  private async request(
    endpoint: string,
    body: Record<string, unknown>,
    method: "POST" | "GET" | "DELETE" = "POST"
  ): Promise<Record<string, unknown>> {
    const url = new URL(`https://${this.config.appName}.metered.live${endpoint}`);
    url.searchParams.set("secretKey", this.config.secretKey);

    const isBodyless = method === "GET" || method === "DELETE";
    if (isBodyless && typeof body.roomName === "string") {
      url.searchParams.set("roomName", body.roomName);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: isBodyless ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      throw new MeteredError(`Metered API HTTP ${response.status}`, response.status);
    }
    return payload;
  }

  async createSession(roomId: string): Promise<void> {
    try {
      await this.request("/api/v1/room", {
        roomName: roomId,
        privacy: "private",
        audioOnlyRoom: true,
        autoJoin: true,
        joinVideoOn: false,
        joinAudioOn: false,
        enableChat: false,
        enableScreenSharing: false,
        showInviteBox: false,
        maxParticipants: this.config.maxParticipants,
        ejectAfterElapsedTimeInSec: this.config.roomTtlSeconds,
      });
    } catch (err) {
      const status = err instanceof MeteredError ? err.status : 502;
      // 400/409 means the room already exists — createSession is idempotent.
      if (status !== 400 && status !== 409) throw err;
    }
  }

  async createAccessToken(roomId: string, displayName: string): Promise<VoiceSessionToken> {
    const result = await this.request("/api/v1/token", {
      roomName: roomId,
      name: displayName,
      isAdmin: false,
    });
    const token = (result.token as string) || (result.accessToken as string);
    if (!token) throw new MeteredError("Metered returned no token", 502);
    return { token, roomUrl: `${this.config.appName}.metered.live/${roomId}` };
  }

  async deleteSession(roomId: string): Promise<void> {
    try {
      await this.request("/api/v1/room", { roomName: roomId }, "DELETE");
    } catch {
      // Best effort: a missing/already-deleted room is not an error for cleanup.
    }
  }
}
