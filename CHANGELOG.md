# Changelog

Alle nennenswerten Änderungen an Commander Link werden in dieser Datei dokumentiert.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).

## [Unreleased]

### Added
- **Desktop: Tastenkombinationen als PTT-Binding.** Push-to-Talk-Tasten können jetzt
  Modifikatoren enthalten (z. B. `Strg + Shift + Ü`). Beim Aufnehmen wird ein einzelner
  Modifikator-Tastendruck ignoriert; die gehaltenen Modifikatoren werden an die nächste
  Nicht-Modifikator-Taste angehängt. Zur Laufzeit löst nur das Loslassen der Basistaste
  das Stummschalten aus (fail-closed).
- **Desktop: Verschlanktes Menü (Datei / Ansicht / Hilfe).** Das Standard-Electron-Menü
  wurde ersetzt.
  - **Datei → Nach Updates suchen** prüft über `electron-updater` (GitHub-Releases-Feed)
    auf neue Versionen. Zusätzlich läuft beim Start ein stiller Check, der nur bei
    verfügbarem Update eine Meldung zeigt.
  - **In-App-Update:** Nach Zustimmung wird das Update heruntergeladen und beim Neustart
    (oder beim nächsten Beenden) installiert. In Dev-/unsignierten Builds oder bei Fehlern
    öffnet sich die GitHub-Release-Seite als Fallback.
  - **Ansicht** bündelt Neu laden, Entwicklertools, Zoom und Vollbild.
  - **Hilfe → Discord-Anleitung** öffnet ein Offline-Hilfefenster: Discord-Sprachraum
    erstellen und die gleiche Taste in Discord auf „Push to Mute“ legen, um ungestört im
    Commander-Chat zu sprechen.
  - **Hilfe → Über Commander Link** öffnet das Repository im Browser.

### Changed
- `apps/desktop/electron-builder.config.cjs` enthält jetzt eine `publish`-Konfiguration
  (GitHub), damit beim Build die `latest.yml` für den Auto-Updater erzeugt wird.
  Das Veröffentlichen bleibt manuell (`--publish never`).
- Der Aufnahme-Hinweis in den Web-Einstellungen weist auf mögliche Tastenkombinationen hin.
