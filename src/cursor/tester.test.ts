import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
import { GODOT_BOOT_WAIT_EVALUATE } from "./godotBootWait.js";
import { MAX_CRITERION_ATTEMPTS, publishScreenshotFromDisk, testerPrompt } from "./tester.js";

test("publishScreenshotFromDisk renames a Playwright file instead of writing bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-shots-"));
  mkdirSync(dir, { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  writeFileSync(join(dir, "page-viewport.png"), png);
  const result = publishScreenshotFromDisk(dir, "criterion-1.png", "page-viewport.png");
  assert.deepEqual(result, { ok: true, filename: "criterion-1.png" });
  assert.deepEqual(readFileSync(join(dir, "criterion-1.png")), png);
});

test("publishScreenshotFromDisk uses the basename when Playwright reports a path", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-shots-"));
  writeFileSync(join(dir, "page-2026.png"), "complete-png");
  const result = publishScreenshotFromDisk(
    dir,
    "criterion-2.png",
    "../game/../data/features/1/screenshots/page-2026.png",
  );
  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(dir, "criterion-2.png"), "utf8"), "complete-png");
});

test("publishScreenshotFromDisk rejects a missing source instead of inventing bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-shots-"));
  const result = publishScreenshotFromDisk(dir, "criterion-1.png", "missing.png");
  assert.deepEqual(result, { ok: false, error: "source screenshot not found: missing.png" });
});

test("tester prompt caps attempts and marks unverifiable checks separately from fail", () => {
  assert.equal(MAX_CRITERION_ATTEMPTS, 5);
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
  );
  assert.match(prompt, /At most 5 attempts per listed criterion/);
  assert.match(prompt, /window\.__egon\.state/);
  assert.match(prompt, /not by guessing from pixels/);
  assert.match(prompt, /\[COULD NOT VERIFY\]/);
  assert.match(prompt, /\[FAIL\] only when the game is clearly wrong/);
  assert.match(prompt, /Treat listed \[COULD NOT VERIFY\] as overall PASS/);
  assert.match(prompt, /Follow the Keys \(browser_press_key\), Click \(browser_mouse_click_xy\), and JS \(browser_evaluate\) named/);
  assert.match(prompt, /browser_mouse_click_xy \/ browser_mouse_move_xy \/ browser_mouse_drag_xy/);
  assert.match(prompt, /Do not call browser_snapshot/);
  assert.match(prompt, /--snapshot-mode=none/);
  assert.ok(prompt.includes(GODOT_BOOT_WAIT_EVALUATE));
  assert.match(prompt, /This wait is not a criterion attempt/);
  assert.match(prompt, /#status-notice/);
  assert.doesNotMatch(prompt, /Wait until the game canvas is visible and not blank/);
  assert.match(prompt, /After boot wait returns ready/);
  assert.match(prompt, /--viewport-size=960x540/);
  assert.match(prompt, /browser_console_messages with level "error"/);
  assert.match(prompt, /no SCRIPT ERROR in the browser console/);
  assert.match(prompt, /0\. no SCRIPT ERROR in console \(implicit; browser_console_messages level: "error"\)/);
  assert.match(prompt, /a scene that throws every frame but still renders must FAIL/);
  assert.match(prompt, /passing filename "criterion-1\.png"/);
  assert.match(prompt, /relative filename stays in --output-dir/);
  assert.match(prompt, /If Playwright saved a different name, publish_screenshot/);
  assert.doesNotMatch(prompt, /Do not pass a filename/);
  assert.doesNotMatch(prompt, /Do not invent Godot inspector access or console-error checks/);
  assert.doesNotMatch(prompt, /Do not click at coordinates/);
});

test("tester prompt injects the game map", () => {
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
    "# Game map\n\n- Viewport: 99x99\n",
  );
  assert.match(prompt, /Prefer this over Glob\/Grep\/Read/);
  assert.match(prompt, /Viewport: 99x99/);
});

test("tester prompt is static-first then feature-specific", () => {
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
    "# Game map\n\n## Project\n\n- Viewport: 99x99\n",
  );
  const mapAt = prompt.indexOf("Viewport: 99x99");
  const factsAt = prompt.indexOf("Game facts (compiled from GAME_MAP");
  const nameAt = prompt.indexOf("Feature: Cannon");
  const criteriaAt = prompt.indexOf("A projectile is visible after firing");
  assert.ok(mapAt >= 0);
  assert.ok(factsAt >= 0);
  assert.ok(mapAt < factsAt);
  assert.ok(factsAt < nameAt);
  assert.ok(nameAt < criteriaAt);
  assert.doesNotMatch(prompt, /Read .+SPEC\.md if needed/);
  assert.doesNotMatch(prompt, /docs\/features\/cannon\/SPEC\.md/);
});

test("tester prompt injects compact GAME_MAP facts instead of a SPEC Read", () => {
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
    [
      "## Project",
      "",
      "- Viewport: 1280x720",
      "",
      "## Input",
      "",
      "| Action | Bindings |",
      "| --- | --- |",
      "| fire | Space |",
      "",
      "## Scenes",
      "",
      "### main.tscn",
      "- HUD (CanvasLayer)",
      "  - Score (Label)",
      "",
    ].join("\n"),
  );
  assert.match(prompt, /do not Read the SPEC/);
  assert.match(prompt, /Canvas: Godot 1280x720; Playwright 960x540/);
  assert.match(prompt, /Expected boot: up to 25s per evaluate, at most 2 calls/);
  assert.match(prompt, /Controls: fire=Space/);
  assert.match(prompt, /HUD: HUD \(CanvasLayer, main\.tscn\); Score \(Label, main\.tscn\)/);
});

test("tester prompt injects the implementer summary after the criteria", () => {
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
    "",
    ["Files changed:", "- player.gd", "Deviations:", "- none"].join("\n"),
  );
  assert.match(prompt, /Implementer summary \(claims, not evidence/);
  assert.match(prompt, /Files changed:/);
  const criteriaAt = prompt.indexOf("A projectile is visible after firing");
  const summaryAt = prompt.indexOf("Implementer summary");
  assert.ok(criteriaAt < summaryAt);
});

test("tester prompt omits the implementer summary when none was recorded", () => {
  const prompt = testerPrompt(
    { name: "Cannon" } as Feature,
    { webServePort: 8080 } as Config,
    ["A projectile is visible after firing"],
  );
  assert.doesNotMatch(prompt, /Implementer summary/);
});

