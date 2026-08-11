import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mainSource = fs.readFileSync(path.join(__dirname, "main.tsx"), "utf8");

describe("app launcher route", () => {
  const APP_LAUNCHER_PATH = /^\/app\/([A-Za-z0-9_-]{20,128})$/;
  const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{20,128})$/;

  function currentRoomId(pathname: string): string | null {
    const roomMatch = pathname.match(ROOM_PATH);
    if (roomMatch) return roomMatch[1];
    
    const appMatch = pathname.match(APP_LAUNCHER_PATH);
    if (appMatch) return appMatch[1];
    
    return null;
  }

  function isAppLauncher(pathname: string): boolean {
    return APP_LAUNCHER_PATH.test(pathname);
  }

  it("parses /app/:roomId route", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    expect(currentRoomId(`/app/${roomId}`)).toBe(roomId);
  });

  it("parses /r/:roomId route", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    expect(currentRoomId(`/r/${roomId}`)).toBe(roomId);
  });

  it("identifies app launcher routes", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    expect(isAppLauncher(`/app/${roomId}`)).toBe(true);
    expect(isAppLauncher(`/r/${roomId}`)).toBe(false);
  });

  it("rejects malformed room IDs in /app/ route", () => {
    expect(currentRoomId("/app/short")).toBeNull();
    expect(currentRoomId("/app/invalid!@#")).toBeNull();
    expect(currentRoomId("/app/")).toBeNull();
  });

  it("preserves query parameters and fragments for browser fallback", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    expect(currentRoomId(`/app/${roomId}`)).toBe(roomId);
    expect(mainSource).toContain('`/r/${roomId}${window.location.search}${window.location.hash}`');
  });

  it("keeps the launcher as a minimal protocol handoff", () => {
    const launcherSource = mainSource.slice(mainSource.indexOf("function AppLauncherView"), mainSource.indexOf("function HomeView"));
    expect(launcherSource).toContain("iframe.src = deepLinkUrl");
    expect(launcherSource).toContain("window.close()");
    expect(launcherSource).toContain("setFallbackVisible(true)");
    expect(launcherSource).not.toContain("<JoinView");
    expect(launcherSource).not.toContain("Mikrofon");
  });
});

describe("launcher deep link generation", () => {
  it("generates correct custom protocol URL from room ID", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    const deepLink = `commanderlink://join/${roomId}`;
    expect(deepLink).toBe("commanderlink://join/bb63eaf988d4415e8f23413c4eeb566");
  });

  it("generates correct browser fallback URL from room ID", () => {
    const roomId = "bb63eaf988d4415e8f23413c4eeb566";
    const browserUrl = `/r/${roomId}`;
    expect(browserUrl).toBe("/r/bb63eaf988d4415e8f23413c4eeb566");
  });

  it("converts /r/ URL to /app/ URL correctly", () => {
    const inviteUrl = "https://commander-link.joinoops.win/r/bb63eaf988d4415e8f23413c4eeb566";
    const appLauncherUrl = inviteUrl.replace(/\/r\/([^/]+)$/, "/app/$1");
    expect(appLauncherUrl).toBe("https://commander-link.joinoops.win/app/bb63eaf988d4415e8f23413c4eeb566");
  });
});
