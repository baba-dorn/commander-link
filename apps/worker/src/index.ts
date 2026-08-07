import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomGate>;
  METERED_REALTIME_KEY_ID: string;
  METERED_REALTIME_SECRET: string;
  APP_ORIGIN: string;
  ROOM_TTL_SECONDS: string;
  TOKEN_TTL_SECONDS: string;
  MAX_ROOM_PEERS: string;
}

// Deliberately not a signalling server. Implement admission/expiry/token-gate only.
export class RoomGate extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return Response.json({ error: "RoomGate scaffold: implement TASKS P2" }, { status: 501 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    return Response.json({ error: "API scaffold: implement TASKS P2" }, { status: 501 });
  },
} satisfies ExportedHandler<Env>;
