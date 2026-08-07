import { app, BrowserWindow } from "electron";

// Scaffold only. Codex must implement secure preload, deep links, single-instance
// routing and a true global press/release PTT source before release.
function createWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 640,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void win.loadURL(process.env.COMMANDER_LINK_WEB_URL ?? "http://localhost:5173");
}

app.whenReady().then(createWindow);
