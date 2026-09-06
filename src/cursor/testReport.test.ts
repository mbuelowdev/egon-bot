import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  listCriterionScreenshots,
  MAX_ACCEPTANCE_CRITERIA,
  parseAcceptanceCriteria,
  parseTestReport,
} from "./testReport.js";

test("parseAcceptanceCriteria reads a numbered list", () => {
  const spec = [
    "# Dash",
    "",
    "## Acceptance criteria",
    "1. Open the game and see a canvas",
    "2. Press Space and the player jumps",
    "",
    "Notes",
  ].join("\n");
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    "Open the game and see a canvas",
    "Press Space and the player jumps",
  ]);
});

test("parseAcceptanceCriteria keeps at most three items", () => {
  const spec = [
    "## Acceptance criteria",
    "1. First",
    "2. Second",
    "3. Third",
    "4. Fourth",
    "5. Fifth",
  ].join("\n");
  assert.equal(MAX_ACCEPTANCE_CRITERIA, 3);
  assert.deepEqual(parseAcceptanceCriteria(spec), ["First", "Second", "Third"]);
});

test("parseTestReport overall PASS only if every criterion passes", () => {
  const pass = parseTestReport("1. [PASS] canvas\n2. [PASS] jump\nOVERALL: PASS");
  assert.equal(pass.overallPass, true);
  assert.equal(pass.hasFailure, false);
  assert.equal(pass.criteria.length, 2);
  const fail = parseTestReport("1. [PASS] canvas\n2. [FAIL] jump is broken");
  assert.equal(fail.overallPass, false);
  assert.equal(fail.hasFailure, true);
  assert.equal(parseTestReport("no criteria here").overallPass, false);
  assert.equal(parseTestReport("no criteria here").hasFailure, false);
});

test("parseTestReport treats could not verify as overall PASS", () => {
  const unverified = parseTestReport(
    "1. [PASS] canvas\n2. [COULD NOT VERIFY] projectile too fast\nOVERALL: PASS",
  );
  assert.equal(unverified.overallPass, true);
  assert.equal(unverified.hasFailure, false);
  assert.equal(unverified.criteria.length, 2);
  assert.equal(unverified.criteria[1]?.status, "COULD_NOT_VERIFY");
  const mixed = parseTestReport("1. [FAIL] hud missing\n2. [COULD NOT VERIFY] projectile");
  assert.equal(mixed.hasFailure, true);
  assert.equal(mixed.overallPass, false);
});

test("listCriterionScreenshots keeps only criterion-1..N in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-criterion-shots-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "page-viewport.png"), "dump");
  writeFileSync(join(dir, "criterion-2.png"), "two");
  writeFileSync(join(dir, "criterion-1.png"), "one");
  writeFileSync(join(dir, "criterion-9.png"), "extra");
  assert.deepEqual(listCriterionScreenshots(dir), ["criterion-1.png", "criterion-2.png"]);
  assert.equal(MAX_ACCEPTANCE_CRITERIA, 3);
});
