// Bridge to the optional Electron preload API. In a plain browser this is undefined
// and every helper degrades gracefully. The desktop shell exposes only these narrow,
// typed capabilities (no Node.js access in the renderer).
import type { PttBinding, PttSettings } from "@commander-link/core";

export interface CommanderLinkBridge {
  readonly isDesktop: true;
  onPttDown(cb: () => void): () => void;
  onPttUp(cb: () => void): () => void;
  onDeepLinkRoom(cb: (roomId: string) => void): () => void;
  getInitialRoom(): Promise<string | null>;
  getPttSettings(): Promise<PttSettings>;
  savePttSettings(settings: PttSettings): Promise<PttSettings>;
  startPttCapture(): Promise<void>;
  cancelPttCapture(): Promise<void>;
  onPttCapture(cb: (binding: PttBinding) => void): () => void;
  onPttCaptureCancelled(cb: () => void): () => void;
  onPttSettingsChanged(cb: (settings: PttSettings) => void): () => void;
}

declare global {
  interface Window {
    commanderLink?: CommanderLinkBridge;
  }
}

export function getBridge(): CommanderLinkBridge | null {
  return window.commanderLink ?? null;
}

export function isDesktop(): boolean {
  return Boolean(window.commanderLink?.isDesktop);
}

/** New settings IPC is optional so an older installed Electron shell can still
 * load the hosted renderer and retain its legacy global PTT behaviour. */
export function supportsPttSettings(): boolean {
  const bridge = getBridge() as Partial<CommanderLinkBridge> | null;
  return Boolean(bridge && typeof bridge.getPttSettings === "function" && typeof bridge.savePttSettings === "function");
}

// Stable "latest Windows installer" URL, routed through the always-current
// GitHub latest-release page so it survives future version bumps.
export const WINDOWS_DOWNLOAD_URL =
  "https://github.com/baba-dorn/commander-link/releases/latest";

export function showWindowsDownload(): boolean {
  return !isDesktop();
}
