import { contextBridge, ipcRenderer } from "electron";

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
});
