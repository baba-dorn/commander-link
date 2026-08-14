import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { openHelpWindow, REPO_URL } from "./help-window";
import { checkForUpdates } from "./updater";

/**
 * Replace the default Electron menu with a trimmed Datei / Ansicht / Hilfe menu.
 * `getWindow` resolves the current main window lazily so menu actions target it
 * even after the window was recreated (macOS activate).
 */
export function buildAppMenu(getWindow: () => BrowserWindow | null): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Datei",
      submenu: [
        { label: "Nach Updates suchen …", click: () => checkForUpdates(true, getWindow()) },
        { type: "separator" },
        { role: "quit", label: "Beenden" },
      ],
    },
    {
      label: "Ansicht",
      submenu: [
        { role: "reload", label: "Neu laden" },
        { role: "forceReload", label: "Neu laden (erzwungen)" },
        { role: "toggleDevTools", label: "Entwicklertools" },
        { type: "separator" },
        { role: "resetZoom", label: "Zoom zurücksetzen" },
        { role: "zoomIn", label: "Vergrößern" },
        { role: "zoomOut", label: "Verkleinern" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Vollbild" },
      ],
    },
    {
      label: "Hilfe",
      submenu: [
        { label: "Discord-Anleitung (Raum & Push-to-Mute)", click: () => openHelpWindow(getWindow()) },
        { type: "separator" },
        { label: "Über Commander Link (GitHub)", click: () => void shell.openExternal(REPO_URL) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
