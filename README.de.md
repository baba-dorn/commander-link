# Commander Link

**Commander Link** ist ein kleiner, privater Push-to-Talk-Sprachkanal für Kommandanten, die ohnehin bereits **Discord** als ihren Haupt-Sprachkanal für Raids nutzen.

> **Was Commander Link NICHT ist:** kein Discord-Ersatz, kein Discord-Bot mit Chat & Co., keine allgemeine Sprach-Plattform. Commander Link ergänzt Discord um einen **zweiten, privaten** Kanal direkt zwischen euch Kommandanten.

---

## Inhaltsverzeichnis

- [Worum geht es?](#worin-geht-es)
- [Produktmodell](#produktmodell)
- [Architektur (einfach erklärt)](#architektur)
- [Sicherheit](#sicherheit)
- [Projekt-Aufbau (Monorepo)](#monorepo)
- [Nutzung: So funktioniert Commander Link](#die-hauptanwendung)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Konfiguration](#konfiguration)
- [Bereitstellung (Deployment)](#bereitstellung)
- [Desktop-App](#desktop-app)
- [Privatsphäre](#privatsphäre)

---

## Worin geht es? {#worin-geht-es}

Ihr seid in einem Raid und nutzt euren privaten Kommando-Sprachkanal. Commander Link ist ein **zweiter Kanal**, mit dem ihr (z. B. die Kommandanten) euch **unabhängig von Discord** auf einer separaten, privaten Audio-Verbindung austauschen könnt – ohne dass der normale Discord-Kanal dadurch gestört wird.

- Für bis zu **4 Teilnehmer**.
- **Audio only** (kein Video, keine Aufzeichnung).
- Push-to-Talk: Man spricht nur, **solange** man eine Taste bzw. einen Button gedrückt hält.

---

## Produktmodell {#produktmodell}

- **Discord bleibt offen** und trägt die normale Raid-/Gruppenkommunikation.
- Commander Link stellt eine **zweite, private, reine Audio-Verbindung** für bis zu 4 Kommandanten bereit.
- **Desktop-Nutzer**: halten die globale Taste **F8** gedrückt, um zu sprechen – auch wenn das Spiel gerade den Fokus hat.
- **Browser-Nutzer**: halten einen großen, roten **Push-to-Talk-Button** auf einem zweiten Bildschirm gedrückt.
- **Loslassen = sofort stumm.** Das ist ein wichtiges Sicherheitsprinzip.
- Browser und Desktop-Clients betreten denselben Raum über denselben **HTTPS-Einladungslink**.

---

## Architektur {#architektur}

```text
Browser React-Client ----\
                          +--> Cloudflare Worker / RoomGate DO --> abgesicherter Metered-Realtime-JWT
Electron + React-Client -/
                                    |
                                    v
                       @metered-ca/realtime (MeteredPeer)
                       Signalisierung + Anwesenheit + ICE-Metadaten
                                    |
                                    v
                       WebRTC Audio-P2P-Netz (max. 4 Teilnehmer)
                       STUN für NAT-Traversal, TURN-Relay nur als Fallback
```

In einfachen Worten:

- Der **Cloudflare Worker** verwaltet nur Raum-Erstellung, Ablauf, das 4-Teilnehmer-Limit und die Vergabe von **kurzlebigen Zugangs-Tickets (JWTs)**.
- Die eigentliche **Verbindung** (Audio zwischen den Teilnehmern) läuft direkt über **WebRTC** von Browser zu Browser – „Peer to Peer". Cloudflare leitet dabei **keine** Medien (Audio/Video) weiter.
- Jeder Commander-Link-Raum ist eindeutig mit einem Realtime-Kanal verknüpft: `commander-link/<raum-id>`. Zugangstickets gelten **nur** für genau diesen einen Kanal.

### ICE-Konfiguration / TURN

Metered Realtime liefert aktuell **keine** ICE-Konfiguration (verifiziert: `metadata.iceServers` ist leer — `TURN configuration received: NO`). Da `@metered-ca/realtime` jede `RTCPeerConnection` intern erzeugt, injiziert der Client einen expliziten **Open-Relay-Fallback** über die `rtcPeerConnectionFactory` des SDK — den einzigen Punkt, durch den jede interne PC-Erstellung läuft (neue Peers und Reconnect-PC-Swaps):

```
Metered-Welcome-iceServers
    ↓
falls nicht leer → nutzen (unverändert)
sonst            → Open-Relay-Fallback (stun/turn/turns auf staticauth.openrelay.metered.ca)
```

Der Produktions-Standard ist `iceTransportPolicy: "all"` (direktes P2P bevorzugt, TURN nur als Fallback). Nur für Diagnose: `?debug=webrtc&forceRelay=1` erzwingt `iceTransportPolicy: "relay"`. Die Open-Relay-Zugangsdaten sind die öffentlichen Metered-Test-Zugangsdaten und werden in den Diagnose-Reports nie im Klartext angezeigt (nur scheme/hostname/port).

### Eigene STUN/TURN-Server verwenden

Den Open-Relay-Fallback durch eigene STUN/TURN-Server ersetzen. Es gibt zwei Wege:

1. **Nur öffentliche Test-Zugangsdaten** — `OPEN_RELAY_ICE_SERVERS` in `apps/web/src/ice-fallback.ts` bearbeiten. Diese Liste landet im Browser-Bundle, also nur für Zugangsdaten verwenden, die öffentlich sein dürfen.

2. **Private TURN-Server (empfohlen)** — `metadata.iceServers` in den geminteten Realtime-JWT in `apps/worker/src/voice/metered.ts` aufnehmen (Body des `POST /v1/tokens`-Requests). Metered reicht diese Metadaten im Welcome-Frame durch, und der Client nutzt sie automatisch — der Open-Relay-Fallback greift nur, wenn `iceServers` fehlt. Die Zugangsdaten bleiben in den Worker-Geheimnissen (`wrangler secret put TURN_USERNAME` / `TURN_PASSWORD`), nie im Client oder im Bundle:

```ts
// apps/worker/src/voice/metered.ts — Token-Mint-Body
body: JSON.stringify({
  peerId,
  channels: [channel],
  permissions: ["publish", "subscribe", "presence", "send"],
  expiresInSec: this.config.tokenTtlSeconds,
  peerMetadata: { username: displayName },
  metadata: {
    iceServers: [
      { urls: "stun:stun.example.com:3478" },
      {
        urls: "turn:turn.example.com:3478?transport=udp",
        username: env.TURN_USERNAME,   // Wrangler-Geheimnis
        credential: env.TURN_PASSWORD, // Wrangler-Geheimnis
      },
    ],
  },
}),
```

Der Client bevorzugt diese Server; der Open-Relay-Fallback wird übersprungen.

---

## Sicherheit {#sicherheit}

1. Die geheimen Metered-Schlüssel (`sk_id` / `sk_secret`) werden **niemals** an Clients ausgeliefert.
2. Clients erhalten nur **kurzlebige, kanalbegrenzte** JWTs (werden serverseitig erstellt).
3. Es werden **nur serverseitig erstellte** Raum-IDs akzeptiert.
4. Maximal **4 Teilnehmer** pro Raum.
5. Räume laufen automatisch ab (Standard: **6 Stunden**).
6. Medien sind im offiziellen Client **nur Audio**.
7. Alle Push-to-Talk-Fehlersituationen führen **standardmäßig auf „stumm"** zurück (Fail-closed).
8. Keine Aufzeichnung, keine Transkription, keine Bots, kein Video, kein Screen-Sharing im MVP.

**Privatsphäre:** Audio only – keine Aufzeichnung, keine Transkription, kein Chat, kein Video, keine Konten im MVP.

---

## Monorepo {#monorepo}

Das Projekt besteht aus mehreren Teilen (und läuft bei dir auf Rechnern/Lokalen):

| Teil | Was |
| --- | --- |
| `apps/web` | React/Vite Web-App – der Browser-Client inkl. des Push-to-Talk-Buttons. |
| `apps/desktop` | Electron-App – Windows-Desktop-Client mit globaler F8-Taste und Einladungslink-Handling. |
| `apps/worker` | Cloudflare Worker – stellt die Raumlogik bereit (RoomGate, Durable Object, Token-Ausstellung). |
| `apps/discord` | Cloudflare Worker für **Discord-Interaktionen**: autorisiert den `/commander`-Befehl und stößt die Raum-Erstellung an. |
| `packages/core` | Geteilter Code: Typen, Raum-/API-Verträge und die Push-to-Talk-Zustandslogik. |
| `docs/` | Detaillierte Dokumentation (Produkt, Architektur, Sicherheit, Netzwerk, Abnahmekriterien). |

---

## Die Hauptanwendung {#die-hauptanwendung}

So nutzt ihr Commander Link:

1. Ein Kommandant erstellt einen Raum über die Web-App (`/commander` in Discord oder der „Raum erstellen"-Button).
2. Als Einladung erhaltet ihr einen Link wie `https://voice.example.org/r/<raum-id>`.
3. Andere Kommandanten öffnen denselben Link im Browser – oder wählen **„Im Desktop-Programm öffnen"**.
4. Electron empfängt einen Link wie `commanderlink://join/<raum-id>`.
5. Jeder Client holt sich beim Worker ein begrenztes Realtime-JWT.
6. `MeteredPeer` tritt dem Raum-Kanal bei, verbindet Teilnehmer direkt (P2P) und wendet die Open-Relay-Fallback-ICE-Konfiguration an, wenn Metered keine liefert.
7. **Alle betreten den Raum stumm.**
8. **F8 halten** (Desktop) oder **roten Button halten** (Browser) = sprechen.
9. **Loslassen = sofort stumm.**

---

## Lokale Entwicklung {#lokale-entwicklung}

**Voraussetzungen:** Node.js 22+, pnpm 10 und ein Metered-Konto mit **Realtime Messaging**. Du brauchst ein Schlüsselpaar (`sk_id` + `sk_secret`) aus dem Dashboard (→ Realtime Messaging → Keys). Für Audio über verschiedene Netze ist kein separater TURN-Dienst nötig — der eingebaute Open-Relay-STUN/TURN-Fallback deckt das MVP ab.

```powershell
# 1. Abhängigkeiten installieren
pnpm install

# 2. Worker-Geheimnisse setzen (niemals committen!)
cd apps/worker
wrangler secret put METERED_REALTIME_KEY_ID    # sk_id_...
wrangler secret put METERED_REALTIME_SECRET    # sk_secret_...
cd ../..

# 3. API (Worker) und Web-App in zwei Terminals starten
pnpm dev:worker    # http://localhost:8788
pnpm dev:web       # http://localhost:5173

# 4. Optional: Desktop-Shell starten (holt die Web-App, ergänzt F8 + Einladungslinks)
pnpm dev:desktop
```

Für `wrangler dev` kannst du die Geheimnisse auch in `apps/worker/.dev.vars` ablegen:

```ini
METERED_REALTIME_KEY_ID=sk_id_...
METERED_REALTIME_SECRET=sk_secret_...
```

Danach `http://localhost:5173` im Browser öffnen, einen Raum erstellen und den Einladungslink in einem zweiten Fenster/Rechner öffnen, um den Ton zu testen.

---

## Konfiguration {#konfiguration}

| Variable | Wo | Zweck |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Web-Build-Env | Basis-URL des Workers (Standard: `http://localhost:8788`). |
| `METERED_REALTIME_KEY_ID` | Worker-**Geheimnis** | Metered-Realtime-Schlüssel-ID (`sk_id_…`). Für die serverseitige Token-Ausstellung. Niemals an Clients weitergeben. |
| `METERED_REALTIME_SECRET` | Worker-**Geheimnis** | Metered-Realtime-Signierschlüssel (`sk_secret_…`). Niemals an Clients weitergeben. |
| `APP_ORIGIN` | Worker `[vars]` | CORS-Freigabeliste + Ursprung für Einladungslinks. |
| `ROOM_TTL_SECONDS` | Worker `[vars]` | Lebensdauer eines Raums (Standard 21600 = 6 h). |
| `TOKEN_TTL_SECONDS` | Worker `[vars]` | Lebensdauer eines Realtime-JWTs (Standard 3600 = 1 h). |
| `MAX_ROOM_PEERS` | Worker `[vars]` | Max. Teilnehmer pro Raum (Standard 4). |

### Discord-Guild-Konfiguration

**Welche** Discord-Server den `/commander`-Befehl nutzen dürfen – und welche Rolle dort die „Kommandeur"-Rolle ist – wird **nicht** über Umgebungsvariablen geregelt, sondern in der Version verwaltet in:

`apps/discord/config/guilds.json`

```json
{
  "guilds": {
    "450409169795678229": {
      "name": "Commander Link Test",
      "commanderRoleId": "1249351808522915991",
      "enabled": true
    }
  }
}
```

- `name`: nur ein Klartext-Label für dich.
- `commanderRoleId`: die **Rollen-ID** (nicht den Namen!) der Kommandeur-Rolle **auf diesem Server**.
- `enabled`: auf `true` gesetzt = Server aktiv; auf `false` = Server vorübergehend deaktiviert.

> **Wichtig:** Guild-IDs und Rollen-IDs sind **keine Geheimnisse** und dürfen eingecheckt werden. Aber **niemals** Schlüssel wie `DISCORD_BOT_TOKEN` oder `ROOM_CREATE_SECRET` in diese Datei schreiben!

**So fügst du einen neuen Server hinzu:**

1. Den **gleichen Discord-Bot** auf den neuen Server installieren (OAuth-Scope `applications.commands`).
2. **Entwicklermodus** in Discord aktivieren (Einstellungen → Erweitert → Entwicklermodus).
3. **Server-ID** kopieren: Rechtsklick auf den Server → Server-ID kopieren.
4. **Kommandeur-Rollen-ID** kopieren: Server-Einstellungen → Rollen → Rechtsklick auf die Rolle → Rollen-ID kopieren.
5. Beides in `guilds.json` ergänzen, `enabled` auf `true` setzen.
6. **Bereitstellen:** `pnpm deploy:discord`
7. **Befehl registrieren:** `pnpm register:discord:command`
8. Testen: einmal mit der Kommandeur-Rolle, einmal als normaler Teilnehmer.

**Server deaktivieren:** `enabled` auf `false` setzen, dann `pnpm deploy:discord` ausführen. Der Server bleibt in der Datei, ist aber gesperrt.

Details findest du in `apps/discord/README.md`.

---

## Bereitstellung {#bereitstellung}

Die Deploy-Skripte laufen vom Repo-Root aus (jedes zielt auf das richtige App-Verzeichnis):

- **Worker/API:** `pnpm deploy:worker` (oder `cd apps/worker && wrangler deploy`). `METERED_REALTIME_KEY_ID` und `METERED_REALTIME_SECRET` per `wrangler secret put` setzen, `APP_ORIGIN` in `wrangler.toml`.
- **Web:** `pnpm deploy:web` baut `apps/web` und stellt es als Static-Assets-Worker `commander-link` bereit (ausgeliefert über die Custom-Domain). Ein SPA-Fallback (`/* → /index.html`) ist konfiguriert, damit `/r/<raum-id>` funktioniert.
- **Desktop:** `pnpm --filter @commander-link/desktop build`, dann mit deinem Electron-Packager paketieren. Die App registriert unter Windows/Linux das `commanderlink://`-Protokoll.
- **Discord:** `pnpm deploy:discord` bündelt die aktuelle `apps/discord/config/guilds.json` in den Worker. Für einen **neuen** Server diesen dort ergänzen, bereitstellen und zusätzlich `pnpm register:discord:command` ausführen, damit `/commander` dort installiert wird. Als Wrangler-Geheimnis sind `ROOM_CREATE_SECRET` (und für das Registrier-Skript `DISCORD_BOT_TOKEN`) zu setzen.

---

## Desktop-App {#desktop-app}

### Windows-Installer

Nutzer installieren Commander Link für Windows über den **aktuellen Release**:

- Browser-Aufruf: die gehostete Web-App verlinkt auf den aktuellen GitHub-Release (`https://github.com/baba-dorn/commander-link/releases/latest`).
- Installer-Datei: `Commander-Link-Setup-<version>.exe` (NSIS, User-Install, Startmenü + optional Desktop-Verknüpfung, Deinstaller, wählbares Installationsverzeichnis).
- Der Installer bewahrt die Registrierung des `commanderlink://`-Protokolls.

> **SmartScreen / Code-Signierung:** Der Installer ist derzeit **nicht signiert**. Windows SmartScreen zeigt u. U. eine Warnung („Unbekannter Herausgeber") – dann einfach „Weitere Informationen" → „Trotzdem ausführen" wählen. Für die öffentliche/produktive Verteilung sollte später eine Authenticode-Code-Signierung eingerichtet werden; das ist bewusst noch nicht konfiguriert.

### Web-URL-Verhalten

Die Desktop-Shell lädt immer die gehostete Produktions-Web-App (`https://commander-link.joinoops.win`). Bei `pnpm dev` (bzw. `pnpm dev:desktop`) lädt sie den lokalen Vite-Dev-Server unter `http://localhost:5173`. Überschreiben zum Testen:

```powershell
$env:COMMANDER_LINK_WEB_URL="https://commander-link.joinoops.win"
pnpm dev:desktop
```

### Einladungslink-Handling

- Die installierte App registriert `commanderlink://` während der Installation (NSIS + electron-builder `protocols`) **und** zur Laufzeit über `setAsDefaultProtocolClient` (du verlässt dich also nicht nur auf den Dev-Modus).
- Ein Link wie `commanderlink://join/<raum-id>` startet die App, wenn sie geschlossen ist; eine bereits laufende Instanz **erhält den Link und fokussiert sich** (Single-Instance-Lock + `second-instance`-Event).
- Der Renderer berührt das Protokoll nie; Raum-IDs aus Einladungslinks laufen über die schmale Preload-Brücke. Electron behält `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` bei.

### Lokaler Build (vom Repo-Root)

**Voraussetzungen:** Node.js 22+, pnpm 10.

```powershell
# Entpackte App (für schnelles Testen): apps/desktop/release/win-unpacked/
pnpm dist:desktop:dir

# Produktions-NSIS-Installer: apps/desktop/release/Commander-Link-Setup-<version>.exe
pnpm dist:desktop:win
```

Entsprechende `--filter`-Varianten: `pnpm --filter @commander-link/desktop dist:dir` / `pnpm --filter @commander-link/desktop dist:win`.

### Release-Ablauf (GitHub Releases)

Automatisiert durch `.github/workflows/release-desktop.yml`:

1. Desktop-Version erhöhen (`apps/desktop/package.json`), committen und pushen.
2. Tag setzen: `git tag v0.1.0`
3. Tag pushen: `git push origin v0.1.0`
4. Der Workflow führt Typecheck, Tests und Build aus, paketiert den Windows-Installer und erstellt/aktualisiert den GitHub-Release mit Tag `v<version>` (Titel `Commander Link v<version>`) inkl. der angehängten `.exe`.

---

## Steam Deck / Linux-Hinweise

Die globale Tastenerfassung ist unter Wayland eingeschränkt. Unter X11 (Steam-Deck-Desktopmodus / Gaming-Modus via `uiohook`) funktioniert F8 grundsätzlich; unter strengen Wayland-Composern evtl. nicht. Die Browser-Version mit dem großen Hold-to-Talk-Button ist auf jeder Plattform der garantierte Fallback.

---

## Fehlerbehebung {#fehlerbehebung}

### Verbinden schlägt fehl mit `token_minting_failed` (502)

Der Worker konnte kein Metered-Realtime-JWT erzeugen. `wrangler dev` protokolliert den sicheren Grund (`console.error`); die Join-Antwort trägt ihn als `reason`:

| `reason` | Bedeutung |
| --- | --- |
| `missing_credentials` | `METERED_REALTIME_KEY_ID`/`METERED_REALTIME_SECRET` sind im Worker-Umfeld gar nicht gesetzt (`.dev.vars` für `wrangler dev`, `wrangler secret` für den Deploy). |
| `placeholder_credentials` | Die Werte sind noch `sk_id_replace-me`/`sk_secret_replace-me`. Echte `sk_id_…`/`sk_secret_…`-Werte aus dem Dashboard verwenden. |
| `unauthorized` | Das Schlüsselpaar ist falsch/ungültig. |
| `channel_not_authorized` | Die `channelPatterns` des Realtime-Schlüssels erlauben `commander-link/*` nicht. |
| `action_not_permitted` | Dem Schlüssel fehlt eine der Aktionen `publish`/`subscribe`/`presence`/`send` (alle vier sind für die WebRTC-Aushandlung nötig). |
| `provider_unreachable` | Der Worker konnte `rms.metered.ca` nicht erreichen (Netzwerk/Ausgang). |

Schnelltest deiner Zugangsdaten außerhalb der App:

```powershell
$body = '{"peerId":"probe","channels":["commander-link/probe"],"permissions":["publish","subscribe","presence","send"],"expiresInSec":3600}'
Invoke-RestMethod -Uri "https://rms.metered.ca/v1/tokens" -Method POST -Headers @{Authorization="Bearer sk_id_YOURS:sk_secret_YOURS"} -ContentType "application/json" -Body $body
```

Ein `token` in der Antwort bedeutet: Schlüssel und Kanal-Scope sind gültig.

### pnpm install / nativer Code

Bei einem frischen `pnpm install` (neuer Clone / CI) greift der Eintrag `pnpm.onlyBuiltDependencies` in der Root-`package.json` und lädt die Binaries automatisch. Falls pnpm die Build-Skripte trotzdem blockiert:

```
Electron: node node_modules/.pnpm/electron@<version>/node_modules/electron/install.js
uiohook: pnpm rebuild uiohook-napi
oder generell pnpm approve-builds
```
