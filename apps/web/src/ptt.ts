// Pointer-driven Push-to-Talk interaction for the web client.
//
// Single Pointer Events implementation: pointerdown starts transmission and
// captures the pointer; every termination path — pointerup, pointercancel,
// lostpointercapture, pointerleave (fallback), window blur, visibility hidden,
// pagehide and unmount — is idempotent and fails closed to muted. The shared
// PttController in @commander-link/core remains the single source of truth for
// the PTT state machine; this module only maps gesture events onto press/release.

export interface PointerLike {
  pointerId: number;
  isPrimary?: boolean;
  button?: number;
}

/** Structural subset of an element needed for pointer capture. */
export interface PointerCaptureElement {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

export interface PttGestureOptions {
  getElement: () => PointerCaptureElement | null;
  onPress: () => void;
  onRelease: () => void;
}

/** Structural subset of window/document used by {@link PttGesture.bindGlobalListeners}. */
export interface GlobalListenerTargets {
  window: {
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
  document: {
    /** Live getter — read at event time so hidden/visible transitions are observed. */
    visibilityState: () => string;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
}

/**
 * Tracks the single active pointer allowed to hold PTT. A second finger or a
 * stray event for another pointer never mutates the state, so one physical
 * touch cannot trigger competing PTT state changes.
 */
export class PttGesture {
  private activePointerId: number | null = null;
  private readonly getElement: () => PointerCaptureElement | null;
  private readonly onPress: () => void;
  private readonly onRelease: () => void;

  constructor(options: PttGestureOptions) {
    this.getElement = options.getElement;
    this.onPress = options.onPress;
    this.onRelease = options.onRelease;
  }

  /** The pointer currently holding PTT, or `null` when muted. */
  get activeId(): number | null {
    return this.activePointerId;
  }

  /** Primary press: capture the pointer and start transmitting. */
  handlePointerDown(event: PointerLike): void {
    if (this.activePointerId !== null) return;
    if (event.isPrimary === false) return;
    if (event.button !== undefined && event.button !== 0) return;
    this.activePointerId = event.pointerId;
    this.capture(event.pointerId);
    this.onPress();
  }

  /** Normal release. */
  handlePointerUp(event: PointerLike): void {
    if (this.activePointerId !== event.pointerId) return;
    this.stopTalking();
  }

  /** Mobile browsers issue pointercancel instead of pointerup when a gesture is interrupted. */
  handlePointerCancel(event: PointerLike): void {
    if (this.activePointerId !== event.pointerId) return;
    this.stopTalking();
  }

  /** Pointer capture disappeared unexpectedly — fail closed immediately. */
  handleLostPointerCapture(event: PointerLike): void {
    if (this.activePointerId !== event.pointerId) return;
    this.stopTalking();
  }

  /**
   * Fallback for environments without pointer capture: leaving the control
   * while holding must stop transmission instead of leaving it stuck on.
   */
  handlePointerLeave(event: PointerLike): void {
    if (this.activePointerId !== event.pointerId) return;
    this.stopTalking();
  }

  /**
   * Idempotent fail-closed release. Safe to call any number of times; a second
   * call is a no-op and never re-enables transmission.
   */
  stopTalking(): void {
    if (this.activePointerId === null) return;
    const pointerId = this.activePointerId;
    this.activePointerId = null;
    const element = this.getElement();
    if (element?.releasePointerCapture) {
      try {
        element.releasePointerCapture(pointerId);
      } catch {
        // Capture is already gone (browsers release it before pointerup).
      }
    }
    this.onRelease();
  }

  /**
   * Register fail-closed focus/page-lifecycle listeners. Returns an
   * unsubscribe function; call it when the control unmounts.
   */
  bindGlobalListeners(targets: GlobalListenerTargets): () => void {
    const onBlur = () => this.stopTalking();
    const onVisibility = () => {
      if (targets.document.visibilityState() === "hidden") this.stopTalking();
    };
    const onPageHide = () => this.stopTalking();
    targets.window.addEventListener("blur", onBlur);
    targets.document.addEventListener("visibilitychange", onVisibility);
    targets.window.addEventListener("pagehide", onPageHide);
    return () => {
      targets.window.removeEventListener("blur", onBlur);
      targets.document.removeEventListener("visibilitychange", onVisibility);
      targets.window.removeEventListener("pagehide", onPageHide);
    };
  }

  private capture(pointerId: number): void {
    const element = this.getElement();
    if (element?.setPointerCapture) {
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // Capture is best-effort; the pointerleave fallback still releases.
      }
    }
  }
}
