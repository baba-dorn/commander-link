# Desktop assets

Place a Windows application icon at `apps/desktop/assets/icon.ico` (ideally with
256x256 and multi-resolution formats). electron-builder uses it for the binary,
window/shortcut and NSIS installer icon.

If `icon.ico` is absent, packaging falls back to the Electron default icon so a
build is never blocked. Add the real icon before a public release.

## Background image

`default.png` is the app's default dark background. A copy is bundled with the
packaged desktop app via `extraResources` (`assets/default.png` inside the
`resources` folder). Sync it whenever `apps/web/public/backgrounds/default.png`
changes. The hosted web renderer continues to load it from the web app's
`/backgrounds/` endpoint.
