import { describe, expect, it } from "vitest";
import {
  OPEN_RELAY_ICE_SERVERS,
  resolveIceConfig,
} from "./ice-fallback";

describe("resolveIceConfig", () => {
  it("keeps Metered-supplied iceServers untouched (no fallback)", () => {
    const metered = [
      { urls: "stun:stun.metered.example:3478" },
      { urls: "turn:turn.metered.example:3478", username: "u", credential: "c" },
    ];
    const { config, fallbackApplied } = resolveIceConfig(
      { iceServers: metered },
      { forceRelay: false }
    );
    expect(fallbackApplied).toBe(false);
    expect(config.iceServers).toBe(metered);
  });

  it("applies the Open Relay fallback when the SDK config has no iceServers", () => {
    const { config, fallbackApplied } = resolveIceConfig(
      undefined,
      { forceRelay: false }
    );
    expect(fallbackApplied).toBe(true);
    expect(config.iceServers).toEqual(OPEN_RELAY_ICE_SERVERS);
  });

  it("applies the fallback when iceServers is an empty array", () => {
    const { config, fallbackApplied } = resolveIceConfig(
      { iceServers: [] },
      { forceRelay: false }
    );
    expect(fallbackApplied).toBe(true);
    expect(config.iceServers).toEqual(OPEN_RELAY_ICE_SERVERS);
  });

  it("keeps production iceTransportPolicy unset (defaults to all)", () => {
    const { config } = resolveIceConfig(undefined, { forceRelay: false });
    expect("iceTransportPolicy" in config).toBe(false);
  });

  it("sets iceTransportPolicy relay only when forceRelay is true", () => {
    const { config } = resolveIceConfig(undefined, { forceRelay: true });
    expect(config.iceTransportPolicy).toBe("relay");
  });

  it("does not override Metered iceServers when forceRelay is set", () => {
    const metered = [{ urls: "stun:stun.metered.example:3478" }];
    const { config, fallbackApplied } = resolveIceConfig(
      { iceServers: metered },
      { forceRelay: true }
    );
    expect(fallbackApplied).toBe(false);
    expect(config.iceServers).toBe(metered);
    expect(config.iceTransportPolicy).toBe("relay");
  });

  it("exposes the expected Open Relay endpoint mix", () => {
    const urls = OPEN_RELAY_ICE_SERVERS.flatMap((s) =>
      Array.isArray(s.urls) ? s.urls : [s.urls]
    );
    expect(urls.filter((u) => u.startsWith("stun:")).length).toBe(2);
    expect(urls.filter((u) => u.startsWith("turn:")).length).toBe(2);
    expect(urls.filter((u) => u.startsWith("turns:")).length).toBe(1);
  });
});
