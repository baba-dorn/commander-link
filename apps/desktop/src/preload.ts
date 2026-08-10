import { contextBridge, ipcRenderer } from "electron";
import type { PttBinding, PttSettings } from "@commander-link/core" with { "resolution-mode": "import" };

// Narrow, typed surface. The renderer gets no Node.js access — only these three
// capabilities: global PTT key events, deep-link room routing and the initial room.
contextBridge.exposeInMainWorld("commanderLink", {
  isDesktop: true,

  onPttDown(cb: () => void): () => void {
    const handler = () => cb();
    ipcRenderer.on("ptt:down", handler);
    return () => ipcRenderer.removeListener("ptt:down", handler);
  },

  onPttUp(cb: () => void): () => void {
    const handler = () => cb();
    ipcRenderer.on("ptt:up", handler);
    return () => ipcRenderer.removeListener("ptt:up", handler);
  },

  onDeepLinkRoom(cb: (roomId: string) => void): () => void {
    const handler = (_event: unknown, roomId: string) => cb(roomId);
    ipcRenderer.on("deeplink:room", handler);
    return () => ipcRenderer.removeListener("deeplink:room", handler);
  },

  getInitialRoom(): Promise<string | null> {
    return ipcRenderer.invoke("deeplink:getInitial");
  },

  getPttSettings(): Promise<PttSettings> {
    return ipcRenderer.invoke("settings:get");
  },

  savePttSettings(settings: PttSettings): Promise<PttSettings> {
    return ipcRenderer.invoke("settings:set", settings);
  },

  startPttCapture(): Promise<void> {
    return ipcRenderer.invoke("ptt:captureStart");
  },

  cancelPttCapture(): Promise<void> {
    return ipcRenderer.invoke("ptt:captureCancel");
  },

  onPttCapture(cb: (binding: PttBinding) => void): () => void {
    const handler = (_event: unknown, binding: PttBinding) => cb(binding);
    ipcRenderer.on("ptt:capture", handler);
    return () => ipcRenderer.removeListener("ptt:capture", handler);
  },

  onPttCaptureCancelled(cb: () => void): () => void {
    const handler = () => cb();
    ipcRenderer.on("ptt:captureCancelled", handler);
    return () => ipcRenderer.removeListener("ptt:captureCancelled", handler);
  },

  onPttSettingsChanged(cb: (settings: PttSettings) => void): () => void {
    const handler = (_event: unknown, settings: PttSettings) => cb(settings);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
});
