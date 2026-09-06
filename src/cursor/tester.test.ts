import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
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
    "/game/docs/features/cannon/SPEC.md",
  );
  assert.match(prompt, /At most 5 attempts per criterion/);
  assert.match(prompt, /projectile or other fleeting visual/);
  assert.match(prompt, /\[COULD NOT VERIFY\]/);
  assert.match(prompt, /\[FAIL\] only when the game is clearly wrong/);
  assert.match(prompt, /Treat \[COULD NOT VERIFY\] as overall PASS/);
});
