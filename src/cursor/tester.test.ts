import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishScreenshotFromDisk } from "./tester.js";

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
