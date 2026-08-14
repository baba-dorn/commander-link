import { app, dialog, shell, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { REPO_URL } from "./help-window";

// Fallback download page when auto-update is unavailable (dev build, network
// error). The GitHub `latest` redirect always points at the newest installer.
const RELEASES_URL = `${REPO_URL}/releases/latest`;

let listenersBound = false;
let manualCheck = false;
let busy = false;
let owner: BrowserWindow | null = null;

function ask(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return owner && !owner.isDestroyed()
    ? dialog.showMessageBox(owner, options)
    : dialog.showMessageBox(options);
}

function bindListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  // User consents before any download; the installed update is applied on the
  // next quit unless the user chooses to restart immediately.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    void ask({
      type: "info",
      buttons: ["Herunterladen", "Später"],
      defaultId: 0,
      cancelId: 1,
      title: "Update verfügbar",
      message: `Version ${info.version} ist verfügbar.`,
      detail: "Möchtest du das Update jetzt herunterladen?",
    }).then(({ response }) => {
      if (response === 0) void autoUpdater.downloadUpdate();
      else busy = false;
    });
  });

  autoUpdater.on("update-not-available", () => {
    busy = false;
    if (!manualCheck) return;
    void ask({
      type: "info",
      buttons: ["OK"],
      title: "Kein Update",
      message: "Du verwendest bereits die neueste Version.",
      detail: `Aktuelle Version: ${app.getVersion()}`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    busy = false;
    void ask({
      type: "info",
      buttons: ["Jetzt neu starten", "Beim Beenden installieren"],
      defaultId: 0,
      cancelId: 1,
      title: "Update bereit",
      message: `Version ${info.version} wurde heruntergeladen.`,
      detail: "Zum Abschließen der Installation wird Commander Link neu gestartet.",
    }).then(({ response }) => {
      // Defer the (blocking) install so the dialog can close cleanly first.
      if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
    });
  });

  autoUpdater.on("error", (error) => {
    busy = false;
    if (!manualCheck) return;
    void ask({
      type: "error",
      buttons: ["Release-Seite öffnen", "Schließen"],
      defaultId: 0,
      cancelId: 1,
      title: "Update fehlgeschlagen",
      message: "Die Update-Prüfung ist fehlgeschlagen.",
      detail: String(error?.message ?? error),
    }).then(({ response }) => {
      if (response === 0) void shell.openExternal(RELEASES_URL);
    });
  });
}

/**
 * Check GitHub for a newer release. `manual` = triggered from the File menu, so
 * "no update"/error dialogs are shown; a silent startup check stays quiet unless
 * an update is found. Auto-update only runs in the packaged app.
 */
export function checkForUpdates(manual: boolean, window: BrowserWindow | null): void {
  owner = window;
  manualCheck = manual;

  if (!app.isPackaged) {
    if (!manual) return;
    void ask({
      type: "info",
      buttons: ["Release-Seite öffnen", "Schließen"],
      defaultId: 0,
      cancelId: 1,
      title: "Updates",
      message: "Automatische Updates sind nur in der installierten App verfügbar.",
      detail: `Aktuelle Version: ${app.getVersion()}`,
    }).then(({ response }) => {
      if (response === 0) void shell.openExternal(RELEASES_URL);
    });
    return;
  }

  if (busy) return;
  busy = true;
  bindListeners();
  void autoUpdater.checkForUpdates().catch(() => {
    busy = false;
  });
}
