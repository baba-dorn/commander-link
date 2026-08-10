import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { uIOhook, UiohookKey } from "uiohook-napi";
import { deepLinkFromArgv, roomFromDeepLink } from "./deep-link";

const DEV_WEB_URL = "http://localhost:5173";
const PROD_WEB_URL = "https://commander-link.joinoops.win";

const WEB_URL =
  process.env.COMMANDER_LINK_WEB_URL ??
  (process.env.NODE_ENV !== "development" ? PROD_WEB_URL : DEV_WEB_URL);

// WebRTC/PTT diagnostics for the packaged app: when the env var is set (e.g.
// `COMMANDER_LINK_DEBUG_LOGS=1` when launching the installed exe), renderer
// console output is piped to stdout and a log file next to the executable, so
// a packaged Windows test can capture `[webrtc] ...` lines without DevTools.
const DEBUG_LOGS = process.env.COMMANDER_LINK_DEBUG_LOGS === "1";
let debugLogStream: fs.WriteStream | null = null;

function setupDebugLogStream(): void {
  if (!DEBUG_LOGS) return;
  try {
    const dir = app.isPackaged ? path.dirname(process.execPath) : process.cwd();
    const stream = fs.createWriteStream(path.join(dir, "commander-link-debug.log"), {
      flags: "a",
    });
    stream.on("error", () => {});
    debugLogStream = stream;
  } catch {
    debugLogStream = null;
  }
}

function pipeDebugLine(line: string): void {
  if (!DEBUG_LOGS) return;
  const stamp = new Date().toISOString();
  const output = `[${stamp}] ${line}`;
  if (debugLogStream) {
    try {
      debugLogStream.write(`${output}\n`);
    } catch {
      // best effort
    }
  } else {
    process.stdout.write(`${output}\n`);
  }
}

// Default global PTT key. Configurable later; F8 keeps clear of common game binds.
const PTT_KEYCODE = UiohookKey.F8;

let mainWindow: BrowserWindow | null = null;
let pendingRoom: string | null = null;
let pttHeld = false;

function routeToRoom(roomId: string): void {
  pendingRoom = roomId;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send("deeplink:room", roomId);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    backgroundColor: "#0d0f13",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (DEBUG_LOGS) {
    // Pipe the renderer's console (including `[webrtc]` instrumentation) out of
    // the packaged window so `?debug=webrtc` is testable on a normal Windows PC.
    mainWindow.webContents.on("console-message", (_event, _level, message) => {
      pipeDebugLine(message);
    });
    // Re-inject the debug flag on every navigation so the URL-query flag is not
    // required in the packaged client.
    mainWindow.webContents.on("did-finish-load", () => {
      void mainWindow?.webContents.executeJavaScript(
        "window.__commanderLinkDebug = true;"
      );
    });
  }
  void mainWindow.loadURL(WEB_URL);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startGlobalPtt(): void {
  // uiohook delivers true global keydown/keyup even when another app (e.g. the game)
  // has focus — required for hold/release semantics that globalShortcut cannot provide.
  uIOhook.on("keydown", (event) => {
    if (event.keycode !== PTT_KEYCODE || pttHeld) return;
    pttHeld = true;
    mainWindow?.webContents.send("ptt:down");
  });
  uIOhook.on("keyup", (event) => {
    if (event.keycode !== PTT_KEYCODE || !pttHeld) return;
    pttHeld = false;
    mainWindow?.webContents.send("ptt:up");
  });
  uIOhook.start();
}

// Single instance: route any second launch (incl. its deep link) into this window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const room = deepLinkFromArgv(argv);
    if (room) routeToRoom(room);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS deep-link delivery.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    const room = roomFromDeepLink(url);
    if (room) routeToRoom(room);
  });

  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("commanderlink", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient("commanderlink");
  }

  // Deep link that launched the app on Windows/Linux is in argv.
  pendingRoom = deepLinkFromArgv(process.argv);

  ipcMain.handle("deeplink:getInitial", () => pendingRoom);

  app.whenReady().then(() => {
    setupDebugLogStream();
    createWindow();
    startGlobalPtt();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    try {
      uIOhook.stop();
    } catch {
      // ignore
    }
    if (debugLogStream) {
      try {
        debugLogStream.end();
      } catch {
        // ignore
      }
      debugLogStream = null;
    }
  });
}
