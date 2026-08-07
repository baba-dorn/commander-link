import { describe, expect, it, vi } from "vitest";
import { PttController, reducePtt, type PttEvent, type PttState } from "./index";

/**
 * Security-critical: no event sequence may leave transmission enabled after a
 * release, focus loss, error, disconnect or reconnect.
 */
const FAIL_CLOSED_EVENTS: PttEvent[] = [
  "release",
  "blur",
  "hidden",
  "error",
  "disconnect",
  "reconnect",
];

describe("reducePtt", () => {
  it("only transmits after an explicit press from muted", () => {
    expect(reducePtt("muted", "press")).toBe("transmitting");
    expect(reducePtt("blocked", "press")).toBe("blocked");
    expect(reducePtt("disconnected", "press")).toBe("disconnected");
    expect(reducePtt("transmitting", "press")).toBe("transmitting");
  });

  it("never remains transmitting after any fail-closed event", () => {
    for (const event of FAIL_CLOSED_EVENTS) {
      expect(reducePtt("transmitting", event)).not.toBe("transmitting");
    }
  });

  it("reconnect always returns muted, never transmitting", () => {
    const states: PttState[] = ["muted", "transmitting", "blocked", "disconnected"];
    for (const state of states) {
      expect(reducePtt(state, "reconnect")).toBe("muted");
    }
  });

  it("survives a stuck-key style sequence without latching transmit", () => {
    // press, focus lost while still "held", late release must not re-enable TX.
    let state: PttState = "muted";
    state = reducePtt(state, "press"); // transmitting
    state = reducePtt(state, "blur"); // muted (fail closed on focus loss)
    state = reducePtt(state, "release"); // still muted
    expect(state).toBe("muted");
  });

  it("cannot transmit after disconnect until reconnect + press", () => {
    let state: PttState = "transmitting";
    state = reducePtt(state, "disconnect");
    expect(state).toBe("disconnected");
    state = reducePtt(state, "press");
    expect(state).toBe("disconnected");
    state = reducePtt(state, "reconnect");
    expect(state).toBe("muted");
    state = reducePtt(state, "press");
    expect(state).toBe("transmitting");
  });
});

describe("PttController", () => {
  it("starts muted by default and notifies listeners on change", () => {
    const controller = new PttController();
    const listener = vi.fn();
    controller.on(listener);

    expect(controller.state).toBe("muted");
    expect(controller.transmitting).toBe(false);

    controller.press();
    expect(controller.transmitting).toBe(true);
    expect(listener).toHaveBeenCalledWith("transmitting", "muted");

    controller.release();
    expect(controller.transmitting).toBe(false);
    expect(listener).toHaveBeenCalledWith("muted", "transmitting");
  });

  it("does not notify when the state is unchanged", () => {
    const controller = new PttController();
    const listener = vi.fn();
    controller.on(listener);
    controller.release(); // already muted -> no change
    expect(listener).not.toHaveBeenCalled();
  });

  it("removes listeners on unsubscribe", () => {
    const controller = new PttController();
    const listener = vi.fn();
    const off = controller.on(listener);
    off();
    controller.press();
    expect(listener).not.toHaveBeenCalled();
  });
});
