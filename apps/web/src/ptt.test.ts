import { describe, expect, it, vi } from "vitest";
import { PttGesture, type GlobalListenerTargets, type PointerLike } from "./ptt";

interface FakeTarget {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function fakeTargets(): {
  targets: GlobalListenerTargets;
  window: FakeTarget;
  document: FakeTarget & { visibilityState: string };
} {
  const window = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const state = { value: "visible" };
  const document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    get visibilityState() {
      return state.value;
    },
    set visibilityState(v: string) {
      state.value = v;
    },
  };
  return {
    targets: {
      window: window as unknown as GlobalListenerTargets["window"],
      document: {
        visibilityState: () => document.visibilityState,
        addEventListener: document.addEventListener,
        removeEventListener: document.removeEventListener,
      } as unknown as GlobalListenerTargets["document"],
    },
    window,
    document,
  };
}

function setupElement() {
  const el = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
  return el;
}

function setup() {
  const press = vi.fn();
  const release = vi.fn();
  const el = setupElement();
  const gesture = new PttGesture({
    getElement: () => el,
    onPress: press,
    onRelease: release,
  });
  return { gesture, press, release, el };
}

const down: PointerLike = { pointerId: 1, isPrimary: true, button: 0 };
const up: PointerLike = { pointerId: 1, isPrimary: true, button: 0 };

describe("PttGesture pointer state machine", () => {
  it("pointerdown -> PTT ON", () => {
    const { gesture, press, el } = setup();
    gesture.handlePointerDown(down);
    expect(press).toHaveBeenCalledTimes(1);
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(gesture.activeId).toBe(1);
  });

  it("pointerdown -> pointerup -> PTT OFF", () => {
    const { gesture, press, release, el } = setup();
    gesture.handlePointerDown(down);
    gesture.handlePointerUp(up);
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(gesture.activeId).toBeNull();
  });

  it("pointerdown -> pointercancel -> PTT OFF", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    gesture.handlePointerCancel(up);
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
  });

  it("pointerdown -> lostpointercapture -> PTT OFF", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    gesture.handleLostPointerCapture(up);
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
  });

  it("pointerdown -> pointerleave -> PTT OFF (fallback without capture)", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    gesture.handlePointerLeave(up);
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
  });

  it("pointerdown -> window blur -> PTT OFF", () => {
    const { gesture, press, release } = setup();
    const { targets, window } = fakeTargets();
    const unbind = gesture.bindGlobalListeners(targets);
    const onBlur = window.addEventListener.mock.calls.find(
      ([type]) => type === "blur"
    )?.[1] as (() => void) | undefined;
    expect(onBlur).toBeTypeOf("function");
    gesture.handlePointerDown(down);
    expect(press).toHaveBeenCalledTimes(1);
    onBlur?.();
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
    unbind();
  });

  it("pointerdown -> document hidden -> PTT OFF", () => {
    const { gesture, press, release } = setup();
    const { targets, document } = fakeTargets();
    const unbind = gesture.bindGlobalListeners(targets);
    const onVisibility = document.addEventListener.mock.calls.find(
      ([type]) => type === "visibilitychange"
    )?.[1] as (() => void) | undefined;
    expect(onVisibility).toBeTypeOf("function");
    gesture.handlePointerDown(down);
    expect(press).toHaveBeenCalledTimes(1);
    document.visibilityState = "hidden";
    onVisibility?.();
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
    unbind();
  });

  it("document visible does not release PTT", () => {
    const { gesture, press, release } = setup();
    const { targets, document } = fakeTargets();
    const unbind = gesture.bindGlobalListeners(targets);
    const onVisibility = document.addEventListener.mock.calls.find(
      ([type]) => type === "visibilitychange"
    )?.[1] as (() => void) | undefined;
    gesture.handlePointerDown(down);
    expect(press).toHaveBeenCalledTimes(1);
    onVisibility?.(); // visibilityState still "visible"
    expect(release).not.toHaveBeenCalled();
    expect(gesture.activeId).toBe(1);
    unbind();
  });

  it("pointer moved outside the button still releases via captured pointerup", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    // Pointer capture means the pointerup reaches the control even outside.
    gesture.handlePointerUp({ ...up, pointerId: 1 });
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(gesture.activeId).toBeNull();
  });
});

describe("PttGesture idempotent fail-closed release", () => {
  it("stopTalking is safe to call multiple times", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    gesture.stopTalking();
    gesture.stopTalking();
    gesture.stopTalking();
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("stopTalking before any press is a harmless no-op", () => {
    const { gesture, release } = setup();
    gesture.stopTalking();
    gesture.stopTalking();
    expect(release).not.toHaveBeenCalled();
  });

  it("repeated pointerup/pointercancel after release does not re-enable audio", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown(down);
    gesture.handlePointerUp(up);
    gesture.handlePointerUp(up);
    gesture.handlePointerCancel(up);
    gesture.handleLostPointerCapture(up);
    gesture.handlePointerLeave(up);
    gesture.stopTalking();
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("PttGesture active-pointer discipline", () => {
  it("ignores a second finger while PTT is held", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown({ pointerId: 1, isPrimary: true, button: 0 });
    gesture.handlePointerDown({ pointerId: 2, isPrimary: false, button: 0 });
    expect(press).toHaveBeenCalledTimes(1);
    // Releasing the non-active finger must not stop the held PTT.
    gesture.handlePointerUp({ pointerId: 2, isPrimary: false, button: 0 });
    expect(release).not.toHaveBeenCalled();
    expect(gesture.activeId).toBe(1);
    gesture.handlePointerUp({ pointerId: 1, isPrimary: true, button: 0 });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("ignores non-primary pointers", () => {
    const { gesture, press, release } = setup();
    gesture.handlePointerDown({ pointerId: 9, isPrimary: false, button: 0 });
    expect(press).not.toHaveBeenCalled();
    gesture.handlePointerUp({ pointerId: 9, isPrimary: false, button: 0 });
    expect(release).not.toHaveBeenCalled();
    expect(gesture.activeId).toBeNull();
  });
});

describe("PttGesture cleanup", () => {
  it("unbind removes all global listeners", () => {
    const { gesture } = setup();
    const { targets, window, document } = fakeTargets();
    const unbind = gesture.bindGlobalListeners(targets);
    unbind();
    expect(window.removeEventListener).toHaveBeenCalledWith(
      "blur",
      expect.any(Function)
    );
    expect(window.removeEventListener).toHaveBeenCalledWith(
      "pagehide",
      expect.any(Function)
    );
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );
  });

  it("releasePointerCapture tolerates missing capture (already released)", () => {
    const release = vi.fn();
    const el = setupElement();
    el.releasePointerCapture.mockImplementation(() => {
      throw new Error("InvalidStateError");
    });
    const gesture = new PttGesture({
      getElement: () => el,
      onPress: () => {},
      onRelease: release,
    });
    gesture.handlePointerDown(down);
    gesture.handlePointerUp(up);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("capture errors are tolerated", () => {
    const el = setupElement();
    el.setPointerCapture.mockImplementation(() => {
      throw new Error("NotSupportedError");
    });
    const press = vi.fn();
    const release = vi.fn();
    const gesture = new PttGesture({
      getElement: () => el,
      onPress: press,
      onRelease: release,
    });
    gesture.handlePointerDown(down);
    expect(press).toHaveBeenCalledTimes(1);
    gesture.handlePointerUp(up);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
