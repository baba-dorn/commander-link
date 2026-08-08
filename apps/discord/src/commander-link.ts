import { CreateRoomResponseSchema, type CreateRoomResponse } from "@commander-link/core";

/**
 * Minimal Commander Link API client used only by the Discord worker.
 *
 * There is exactly ONE room-creation implementation in the project: the
 * existing Worker endpoint `POST /v1/rooms`. This module simply calls it with
 * the shared server-to-server secret, so Discord is a trigger/authorizer and
 * never re-implements room id generation, TTL, Durable Object logic or invite
 * URL generation.
 *
 * In Phase 1 (transitional rollout) the API does not yet enforce the secret —
 * existing browser/desktop room creation is preserved. This module already
 * sends the header so it is ready for the later lockdown described in
 * apps/discord/README.md.
 */

export interface Environment {
  commanderLinkApiUrl: string;
  roomCreateSecret: string;
}

export class CommanderLinkError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export async function createCommanderRoom(env: Environment): Promise<CreateRoomResponse> {
  const base = env.commanderLinkApiUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/v1/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.roomCreateSecret}`,
      },
    });
  } catch {
    // Network / DNS errors. Never log credentials.
    throw new CommanderLinkError("Commander Link API unreachable");
  }

  if (!response.ok) {
    // Do not log the response body (it is not trusted and we never reveal
    // internal configuration or secrets to the Discord user).
    throw new CommanderLinkError(`Commander Link API error ${response.status}`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CommanderLinkError("Commander Link API returned malformed data");
  }

  const parsed = CreateRoomResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CommanderLinkError("Commander Link API returned malformed data");
  }
  return parsed.data;
}
