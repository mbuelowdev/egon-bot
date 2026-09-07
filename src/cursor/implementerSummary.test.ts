import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadImplementerSummary, persistImplementerSummary } from "./implementerSummary.js";
import { featurePaths } from "./testReport.js";

const SAMPLE = [
  "Files changed:",
  "- scripts/player.gd",
  "Criteria self-verified:",
  "1. [PASS] playerX increased by 80 after Space",
  "Deviations:",
  "- none",
].join("\n");

test("persistImplementerSummary writes IMPLEMENT_SUMMARY.md", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-sum-"));
  persistImplementerSummary(dataDir, 7, SAMPLE);
  assert.equal(readFileSync(featurePaths(dataDir, 7).implementerSummaryPath, "utf8"), SAMPLE);
  assert.equal(loadImplementerSummary(dataDir, 7), SAMPLE);
});

test("loadImplementerSummary returns undefined when missing or blank", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-empty-"));
  assert.equal(loadImplementerSummary(dataDir, 1), undefined);
  persistImplementerSummary(dataDir, 1, "   \n");
  assert.equal(loadImplementerSummary(dataDir, 1), undefined);
});
