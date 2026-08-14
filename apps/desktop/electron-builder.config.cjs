const fs = require("node:fs");
const path = require("node:path");

// Dedicated electron-builder configuration for the Commander Link desktop app.
// The renderer is the hosted public web app, so only the compiled Electron
// main/preload plus runtime dependencies are packaged.

const iconPath = path.join(__dirname, "assets", "icon.ico");
const hasIcon = fs.existsSync(iconPath);

/** @type import("electron-builder").Configuration */
const config = {
  appId: "de.dorn.commanderlink",
  productName: "Commander Link",
  directories: {
    output: "release",
    buildResources: "assets",
  },
  extraResources: [
    {
      from: "assets/default.png",
      to: "assets/default.png",
    },
  ],
  files: [
    "dist/**",
    "package.json",
    "!src/**",
    "!release/**",
    "!electron-builder.config.cjs",
  ],
  // uiohook-napi resolves its native N-API binary at runtime via node-gyp-build.
  // It cannot load from inside the packed asar archive, so it must be unpacked.
  asarUnpack: ["**/node_modules/uiohook-napi/**"],
  protocols: [{ name: "Commander Link", schemes: ["commanderlink"] }],
  // GitHub Releases feed for electron-updater. Building emits `latest.yml`
  // alongside the installer so the packaged app's "Nach Updates suchen" can
  // discover and download newer releases. Publishing stays manual (`--publish never`).
  publish: [{ provider: "github", owner: "baba-dorn", repo: "commander-link" }],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    // Icon is optional: packaging falls back to the Electron default until a
    // final assets/icon.ico is provided. Deliberately non-fatal.
    ...(hasIcon ? { icon: iconPath } : {}),
  },
  // Linux / Steam Deck: the top-level `protocols` entry above registers
  // `commanderlink://` in the generated .desktop handler here too. AppImage is
  // the default, portable target that keeps the prototype buildable without
  // extra native packaging deps.
  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    category: "AudioVideo",
    ...(hasIcon ? { icon: iconPath } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Commander Link",
    uninstallDisplayName: "Commander Link",
    artifactName: "Commander-Link-Setup-${version}.${ext}",
  },
};

module.exports = config;
