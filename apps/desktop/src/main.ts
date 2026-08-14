import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { uIOhook, UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from "uiohook-napi";
import type { PttBinding, PttSettings } from "@commander-link/core" with { "resolution-mode": "import" };
import { deepLinkFromArgv, roomFromDeepLink } from "./deep-link";
import { buildAppMenu } from "./menu";
import { checkForUpdates } from "./updater";

// Modifier keys are never captured as a standalone PTT binding: capturing waits
// for the actual key so combinations like Ctrl+Shift+Ü can be recorded.
const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl, UiohookKey.CtrlRight,
  UiohookKey.Alt, UiohookKey.AltRight,
  UiohookKey.Shift, UiohookKey.ShiftRight,
  UiohookKey.Meta, UiohookKey.MetaRight,
]);

function isModifierKeycode(keycode: number): boolean {
  return MODIFIER_KEYCODES.has(keycode);
}

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

const DEFAULT_SETTINGS: PttSettings = {
  primaryPttBinding: null,
  secondaryPttBinding: null,
  microphoneDevice: "default",
  audioOutputDevice: "default",
};

let mainWindow: BrowserWindow | null = null;
let pendingRoom: string | null = null;
let pttHeld = false;
let activeBindings = new Set<string>();
let capturing = false;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function isBinding(value: unknown): value is PttBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  if (binding.type === "mouse") return Number.isInteger(binding.button) && typeof binding.label === "string";
  return binding.type === "keyboard" && Number.isInteger(binding.keycode) && typeof binding.label === "string";
}

function loadSettings(): PttSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Partial<PttSettings>;
    return {
      primaryPttBinding: isBinding(raw.primaryPttBinding) ? raw.primaryPttBinding : null,
      secondaryPttBinding: isBinding(raw.secondaryPttBinding) ? raw.secondaryPttBinding : null,
      microphoneDevice: typeof raw.microphoneDevice === "string" ? raw.microphoneDevice : "default",
      audioOutputDevice: typeof raw.audioOutputDevice === "string" ? raw.audioOutputDevice : "default",
    };
  } catch {
    // Existing profiles from before configurable PTT get a one-time F8 migration.
    // A new profile remains unconfigured and is guided through the settings UI.
    const userData = app.getPath("userData");
    const looksExisting = fs.existsSync(path.join(userData, "Preferences")) || fs.existsSync(path.join(userData, "Local Storage"));
    return looksExisting
      ? { ...DEFAULT_SETTINGS, primaryPttBinding: keyboardBinding(UiohookKey.F8) }
      : { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next: PttSettings): void {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    // Settings persistence failure must never leave the microphone transmitting.
    resetPttState();
  }
}

let settings = loadSettings();

function pttBindingKey(binding: PttBinding): string {
  if (binding.type === "mouse") return `mouse:${binding.button}`;
  const modifiers = binding.modifiers ?? {};
  return `keyboard:${binding.keycode}:${Boolean(modifiers.ctrl)}:${Boolean(modifiers.alt)}:${Boolean(modifiers.shift)}:${Boolean(modifiers.meta)}`;
}

function keyboardBinding(keycode: number, event?: Pick<UiohookKeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): PttBinding {
  const entry = Object.entries(UiohookKey).find(([, value]) => value === keycode);
  const label = entry?.[0] ?? `Taste ${keycode}`;
  const modifiers = event && {
    ctrl: event.ctrlKey || undefined,
    alt: event.altKey || undefined,
    shift: event.shiftKey || undefined,
    meta: event.metaKey || undefined,
  };
  return { type: "keyboard", keycode, label: modifiers && Object.values(modifiers).some(Boolean) ? modifierLabel(modifiers, label) : label, modifiers };
}

function modifierLabel(modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }, key: string): string {
  return [...(modifiers.ctrl ? ["Ctrl"] : []), ...(modifiers.alt ? ["Alt"] : []), ...(modifiers.shift ? ["Shift"] : []), ...(modifiers.meta ? ["Win"] : []), key].join(" + ");
}

function mouseBinding(button: number): PttBinding {
  return { type: "mouse", button, label: button === 4 ? "Mouse 4" : button === 5 ? "Mouse 5" : `Mouse ${button}` };
}

function resetPttState(): void {
  activeBindings.clear();
  if (pttHeld) {
    pttHeld = false;
    mainWindow?.webContents.send("ptt:up");
  }
}

function bindingForKeyboard(event: UiohookKeyboardEvent): PttBinding {
  return keyboardBinding(event.keycode, event);
}

function matches(binding: PttBinding | null, event: UiohookKeyboardEvent | UiohookMouseEvent, pressed: boolean): boolean {
  if (!binding) return false;
  if (binding.type === "mouse") return "button" in event && Number(event.button) === binding.button;
  if (!("keycode" in event) || event.keycode !== binding.keycode) return false;
  // Release events must still clear a held binding if a modifier was released
  // first; otherwise a lost modifier state could leave the microphone open.
  if (!pressed) return true;
  const modifiers = binding.modifiers ?? {};
  return Boolean(modifiers.ctrl) === event.ctrlKey && Boolean(modifiers.alt) === event.altKey && Boolean(modifiers.shift) === event.shiftKey && Boolean(modifiers.meta) === event.metaKey;
}

function processInput(event: UiohookKeyboardEvent | UiohookMouseEvent, pressed: boolean): void {
  try {
    if (capturing) {
      if (pressed && "keycode" in event && event.keycode === UiohookKey.Escape) {
        capturing = false;
        mainWindow?.webContents.send("ptt:captureCancelled");
        return;
      }
      // A lone modifier keydown does not finish capture; the currently held
      // modifiers are attached to the next non-modifier key by keyboardBinding.
      if (pressed && "keycode" in event && isModifierKeycode(event.keycode)) return;
      if (pressed && (("keycode" in event && event.keycode !== UiohookKey.Escape) || ("button" in event && Number(event.button) >= 4 && Number(event.button) <= 5))) {
        const binding = "keycode" in event ? bindingForKeyboard(event) : mouseBinding(Number(event.button));
        capturing = false;
        mainWindow?.webContents.send("ptt:capture", binding);
      }
      return;
    }
    const bindings = [settings.primaryPttBinding, settings.secondaryPttBinding];
    const matching = bindings.filter((binding): binding is PttBinding => matches(binding, event, pressed));
    if (matching.length === 0) return;
    for (const binding of matching) {
      const key = pttBindingKey(binding);
      if (pressed) activeBindings.add(key);
      else activeBindings.delete(key);
    }
    const nextHeld = activeBindings.size > 0;
    if (nextHeld !== pttHeld) {
      pttHeld = nextHeld;
      mainWindow?.webContents.send(nextHeld ? "ptt:down" : "ptt:up");
    }
  } catch {
    resetPttState();
  }
}

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
  uIOhook.on("keydown", (event) => processInput(event, true));
  uIOhook.on("keyup", (event) => processInput(event, false));
  uIOhook.on("mousedown", (event) => processInput(event, true));
  uIOhook.on("mouseup", (event) => processInput(event, false));
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
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:set", (_event, next: unknown) => {
    if (!next || typeof next !== "object") return settings;
    const candidate = next as Partial<PttSettings>;
    const primary = candidate.primaryPttBinding === null || isBinding(candidate.primaryPttBinding) ? candidate.primaryPttBinding : settings.primaryPttBinding;
    const secondary = candidate.secondaryPttBinding === null || isBinding(candidate.secondaryPttBinding) ? candidate.secondaryPttBinding : settings.secondaryPttBinding;
    if (primary && secondary && pttBindingKey(primary) === pttBindingKey(secondary)) return settings;
    resetPttState();
    settings = {
      primaryPttBinding: primary ?? null,
      secondaryPttBinding: secondary ?? null,
      microphoneDevice: typeof candidate.microphoneDevice === "string" ? candidate.microphoneDevice : settings.microphoneDevice,
      audioOutputDevice: typeof candidate.audioOutputDevice === "string" ? candidate.audioOutputDevice : settings.audioOutputDevice,
    };
    saveSettings(settings);
    mainWindow?.webContents.send("settings:changed", settings);
    return settings;
  });
  ipcMain.handle("ptt:captureStart", () => { resetPttState(); capturing = true; });
  ipcMain.handle("ptt:captureCancel", () => { capturing = false; resetPttState(); });

  app.whenReady().then(() => {
    setupDebugLogStream();
    buildAppMenu(() => mainWindow);
    createWindow();
    startGlobalPtt();
    // Silent startup check: only surfaces UI if an update is actually available.
    checkForUpdates(false, mainWindow);
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
