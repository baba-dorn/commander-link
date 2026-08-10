// Open Relay (Metered's public STUN/TURN service) fallback ICE configuration.
//
// Metered Realtime's welcome frame currently delivers no `metadata.iceServers`
// (verified: `TURN configuration received: NO`), so the SDK builds every
// RTCPeerConnection without ICE servers and cross-network calls stay stuck in
// `checking`. This module provides the well-known public Open Relay endpoints as
// a fallback that is injected at the SDK's RTCPeerConnection factory.
//
// Open Relay credentials are public (published by Metered for exactly this
// purpose). They are still never surfaced verbatim in diagnostics — the report
// only shows scheme/hostname/port and flags credential presence.

export const OPEN_RELAY_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: "stun:staticauth.openrelay.metered.ca:80",
  },
  {
    urls: "stun:staticauth.openrelay.metered.ca:443",
  },
  {
    urls: "turn:staticauth.openrelay.metered.ca:80",
    username: "openrelayprojectsecret",
    credential: "openrelayprojectsecret",
  },
  {
    urls: "turn:staticauth.openrelay.metered.ca:443",
    username: "openrelayprojectsecret",
    credential: "openrelayprojectsecret",
  },
  {
    urls: "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
    username: "openrelayprojectsecret",
    credential: "openrelayprojectsecret",
  },
];

export interface IceConfigDecision {
  /** The configuration to hand to `new RTCPeerConnection(config)`. */
  config: RTCConfiguration;
  /** True when Metered supplied no usable iceServers and the fallback was applied. */
  fallbackApplied: boolean;
}

/**
 * Resolve the ICE configuration for an RTCPeerConnection the SDK is about to
 * create.
 *
 * Preference (per the product boundary):
 *   1. Metered welcome `metadata.iceServers` when non-empty — passed through
 *      untouched.
 *   2. Otherwise the Open Relay fallback servers, so every actual
 *      RTCPeerConnection has working STUN/TURN.
 *
 * `forceRelay` (debug-only, `?debug=webrtc&forceRelay=1`) sets
 * `iceTransportPolicy: "relay"`. Production default (absent property) stays
 * `"all"` — this function never sets the policy to "all" explicitly.
 */
export function resolveIceConfig(
  sdkConfig: RTCConfiguration | undefined,
  opts: { forceRelay: boolean }
): IceConfigDecision {
  const config: RTCConfiguration = { ...(sdkConfig ?? {}) };
  const hasServers =
    Array.isArray(config.iceServers) && config.iceServers.length > 0;
  const fallbackApplied = !hasServers;
  if (fallbackApplied) {
    config.iceServers = OPEN_RELAY_ICE_SERVERS;
  }
  if (opts.forceRelay) {
    config.iceTransportPolicy = "relay";
  }
  return { config, fallbackApplied };
}
