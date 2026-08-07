// Bridge to the optional Electron preload API. In a plain browser this is undefined
// and every helper degrades gracefully. The desktop shell exposes only these narrow,
// typed capabilities (no Node.js access in the renderer).

export interface CommanderLinkBridge {
  readonly isDesktop: true;
  onPttDown(cb: () => void): () => void;
  onPttUp(cb: () => void): () => void;
  onDeepLinkRoom(cb: (roomId: string) => void): () => void;
  getInitialRoom(): Promise<string | null>;
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
