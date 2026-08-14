import { BrowserWindow, shell } from "electron";

// Public GitHub repository. The "About" menu entry and the help page footer link
// here; the releases sub-path is reused by the updater fallback.
export const REPO_URL = "https://github.com/baba-dorn/commander-link";

let helpWindow: BrowserWindow | null = null;

/**
 * Open (or focus) the offline help window. It explains how to run Commander Link
 * as a private backchannel *beside* Discord: create a Discord voice room and bind
 * the same key to Discord "Push to Mute" so holding PTT talks in Commander Link
 * while muting Discord.
 */
export function openHelpWindow(parent?: BrowserWindow | null): void {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }
  helpWindow = new BrowserWindow({
    width: 660,
    height: 780,
    title: "Commander Link — Hilfe",
    backgroundColor: "#0d0f13",
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  helpWindow.setMenuBarVisibility(false);

  // The help page is static local HTML; any real navigation opens in the OS
  // browser instead of replacing the offline help content.
  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  helpWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:")) return;
    event.preventDefault();
    if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
  });

  void helpWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(helpHtml()));
  helpWindow.on("closed", () => {
    helpWindow = null;
  });
}

/** The self-contained help document (kept as a pure string so it needs no asset copy). */
export function helpHtml(): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Commander Link — Hilfe</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 28px 40px;
    font: 15px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e6e9ef;
    background: #0d0f13;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; color: #9fb4ff; }
  p { margin: 8px 0; color: #c3c9d4; }
  ol { margin: 8px 0 8px 20px; padding: 0; }
  li { margin: 6px 0; color: #c3c9d4; }
  kbd {
    display: inline-block;
    padding: 1px 7px;
    border: 1px solid #39414f;
    border-bottom-width: 2px;
    border-radius: 6px;
    background: #1a1f28;
    color: #f2f5fa;
    font: 12px/1.4 "Cascadia Code", Consolas, monospace;
  }
  .lead { color: #aeb6c4; margin-bottom: 4px; }
  .card {
    margin-top: 20px;
    padding: 16px 18px;
    border: 1px solid #232a35;
    border-radius: 12px;
    background: #12161d;
  }
  .tip { border-left: 3px solid #5b7cff; padding-left: 12px; color: #b9c2d4; }
  a { color: #8aa4ff; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #232a35; color: #8b93a3; font-size: 13px; }
</style>
</head>
<body>
  <h1>Commander Link neben Discord nutzen</h1>
  <p class="lead">Commander Link ist ein privater Push-to-Talk-Kanal für 2–4 Personen, der <strong>parallel</strong> zu deinem normalen Discord-Raid läuft. So sprichst du ungestört im Commander-Chat, ohne dass die ganze Gruppe in Discord mithört.</p>

  <div class="card">
    <h2>1. Discord-Sprachraum erstellen</h2>
    <ol>
      <li>Öffne Discord und wähle deinen Server (oder erstelle über <kbd>+</kbd> einen neuen Server).</li>
      <li>Klicke neben „Sprachkanäle“ auf <kbd>+</kbd> und lege einen <strong>Sprachkanal</strong> an, z. B. „Raid“.</li>
      <li>Tritt dem Sprachkanal bei und lade deine Mitspieler ein – hier läuft weiterhin die normale Raid-Kommunikation.</li>
    </ol>
  </div>

  <div class="card">
    <h2>2. Gleiche Taste in Discord auf „Push to Mute“ legen</h2>
    <p>Damit du im Commander-Chat sprechen kannst, ohne dass Discord dich hört, belegst du <strong>dieselbe Taste</strong> wie deine Commander-Link-PTT-Taste in Discord mit „Push to Mute“ (Drücken zum Stummschalten):</p>
    <ol>
      <li>Discord → <strong>Benutzereinstellungen</strong> (Zahnrad) → <strong>Sprache &amp; Video</strong>.</li>
      <li>Scrolle zu <strong>Tastenkombinationen</strong> bzw. öffne Einstellungen → <strong>Tastenkombinationen</strong>.</li>
      <li>Füge eine neue Tastenkombination hinzu und wähle die Aktion <strong>„Stummschalten aktivieren (Push to Mute)“</strong>.</li>
      <li>Weise <strong>exakt die Taste zu, die du in Commander Link als PTT nutzt</strong> (Standard <kbd>F8</kbd>, oder deine eigene Kombination wie <kbd>Strg</kbd> + <kbd>Shift</kbd> + <kbd>Ü</kbd>).</li>
    </ol>
    <p class="tip">Ergebnis: Solange du die Taste hältst, <strong>sendest du in Commander Link</strong> und bist <strong>gleichzeitig in Discord stumm</strong>. Beim Loslassen bist du in Commander Link wieder stumm und in Discord wieder hörbar.</p>
  </div>

  <div class="card">
    <h2>3. PTT-Taste in Commander Link einstellen</h2>
    <ol>
      <li>Öffne in Commander Link über das <strong>Zahnrad</strong> die Einstellungen.</li>
      <li>Klicke bei „PTT-Taste“ auf <strong>Ändern</strong> und drücke deine gewünschte Taste oder Kombination.</li>
      <li>Kombinationen mit <kbd>Strg</kbd>, <kbd>Alt</kbd>, <kbd>Shift</kbd> oder <kbd>Win</kbd> werden unterstützt – halte die Modifikatoren gedrückt und tippe die Zieltaste.</li>
    </ol>
  </div>

  <footer>
    Commander Link ist Open Source. Quellcode, Releases und Issues:
    <a href="${REPO_URL}">${REPO_URL}</a>
  </footer>
</body>
</html>`;
}
