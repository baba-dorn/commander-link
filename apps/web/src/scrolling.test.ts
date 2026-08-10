import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The room page must stay naturally vertically scrollable on phones. No
// page-wide touch suppression (touch-action: none on body/#root/.shell) and no
// overflow hidden may sit on high-level containers. Gesture restrictions are
// only allowed on the PTT control itself.
describe("mobile scrolling: no page-wide touch suppression", () => {
  const css = fs.readFileSync(path.join(__dirname, "styles.css"), "utf8");
  const mainSource = fs.readFileSync(path.join(__dirname, "main.tsx"), "utf8");

  const pageScopeTouchActionNone = [
    "body {",
    "body{",
    "html {",
    "html{",
    "#root {",
    "#root{",
    ".shell {",
    ".shell{",
    ".shell.room",
  ];

  it("does not set touch-action: none on body, html, #root or .shell", () => {
    for (const scope of pageScopeTouchActionNone) {
      // Conservative: only flag an occurrence that is immediately followed by a
      // touch-action: none declaration within the same rule block.
      const blockStart = css.indexOf(scope);
      if (blockStart === -1) continue;
      const block = css.slice(blockStart, css.indexOf("}", blockStart) + 1);
      expect(block).not.toMatch(/touch-action\s*:\s*none/);
    }
  });

  it("scopes the only touch-action: none to the PTT control", () => {
    const occurrences = css.match(/touch-action\s*:\s*none/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(css).toMatch(/\.ptt\s*{[\s\S]*touch-action\s*:\s*none/);
  });

  it("does not use overflow: hidden on high-level page containers", () => {
    const pageScopeOverflowHidden = ["body {", "html {", "#root {", ".shell {"];
    for (const scope of pageScopeOverflowHidden) {
      const blockStart = css.indexOf(scope);
      if (blockStart === -1) continue;
      const block = css.slice(blockStart, css.indexOf("}", blockStart) + 1);
      expect(block).not.toMatch(/overflow\s*:\s*hidden/);
    }
    expect(mainSource).not.toMatch(
      /addEventListener\(\s*["'](touchmove|pointermove)["']\s*,\s*\(?\s*\w+\s*\)?\s*=>\s*\{?\s*\w+\.preventDefault\(\)/
    );
  });

  it("uses mobile-safe dvh viewport units on high-level containers", () => {
    expect(css).toMatch(/#root\s*{[\s\S]*min-height\s*:\s*100dvh/);
    expect(css).toMatch(/\.join-gate,\s*\.home\s*{[\s\S]*min-height\s*:\s*100dvh/);
    expect(css).toMatch(/\.shell\.launcher\s*{[\s\S]*min-height\s*:\s*100dvh/);
  });

  it("keeps pointer-events: none on the fixed decorative overlays", () => {
    const before = css.slice(0, css.indexOf("#root"));
    const overlayBlocks = before.match(/\{[\s\S]*?pointer-events\s*:\s*none\s*;[\s\S]*?\}/g) ?? [];
    expect(overlayBlocks.length).toBeGreaterThanOrEqual(2);
  });
});
