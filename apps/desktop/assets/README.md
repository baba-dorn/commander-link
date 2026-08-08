# Desktop assets

Place a Windows application icon at `apps/desktop/assets/icon.ico` (ideally with
256x256 and multi-resolution formats). electron-builder uses it for the binary,
window/shortcut and NSIS installer icon.

If `icon.ico` is absent, packaging falls back to the Electron default icon so a
build is never blocked. Add the real icon before a public release.
