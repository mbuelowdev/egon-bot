import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ensureImplicitConsoleCriterion,
  listCriterionScreenshots,
  MAX_ACCEPTANCE_CRITERIA,
  MISSING_CONSOLE_CRITERION_LINE,
  parseAcceptanceCriteria,
  parseTestReport,
  unverifiedCount,
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

test("parseAcceptanceCriteria keeps Keys/JS/Then lines intact", () => {
  const spec = [
    "## 7. Acceptance criteria",
    "1. Keys: Space. JS: `() => window.__egon.state().playerX`. Then: return increases by 80.",
    "2. Keys: none. JS: `() => window.__egon.state().score`. Then: return is 1.",
    "",
    "## 8. Explicitly NOT this task",
    "- None.",
  ].join("\n");
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    "Keys: Space. JS: `() => window.__egon.state().playerX`. Then: return increases by 80.",
    "Keys: none. JS: `() => window.__egon.state().score`. Then: return is 1.",
  ]);
});

test("parseAcceptanceCriteria reads a numbered heading and stops at the next section", () => {
  const spec = [
    "## 5. Implementation notes / constraints",
    "- use a Timer node",
    "",
    "## 7. Acceptance criteria",
    "1. Given the game is open, when the HUD loads, then the speed label is visible",
    "2. Given speed exceeds 10, when idle, then the label is red",
    "",
    "## 8. Explicitly NOT this task",
    "- do not add new dependencies",
    "- do not retouch the main menu",
  ].join("\n");
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    "Given the game is open, when the HUD loads, then the speed label is visible",
    "Given speed exceeds 10, when idle, then the label is red",
  ]);
});

test("parseAcceptanceCriteria ignores Verification hooks and stops at the next section", () => {
  const spec = [
    "## 6. Verification hooks",
    "- `window.__egon.state()` returns `{ score: number }`",
    "",
    "## 7. Acceptance criteria",
    "1. Keys: none. JS: `() => window.__egon.state().score`. Then: return is 0.",
    "",
    "## 8. Explicitly NOT this task",
    "- None.",
  ].join("\n");
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    "Keys: none. JS: `() => window.__egon.state().score`. Then: return is 0.",
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

test("parseTestReport overall PASS only if criterion 0 and every listed criterion pass", () => {
  const pass = parseTestReport(
    "0. [PASS] no SCRIPT ERROR in console\n1. [PASS] canvas\n2. [PASS] jump\nOVERALL: PASS",
  );
  assert.equal(pass.overallPass, true);
  assert.equal(pass.hasFailure, false);
  assert.equal(pass.criteria.length, 3);
  const fail = parseTestReport(
    "0. [PASS] no SCRIPT ERROR in console\n1. [PASS] canvas\n2. [FAIL] jump is broken",
  );
  assert.equal(fail.overallPass, false);
  assert.equal(fail.hasFailure, true);
  assert.equal(parseTestReport("no criteria here").overallPass, false);
  assert.equal(parseTestReport("no criteria here").hasFailure, false);
});

test("parseTestReport fails overall when the console has SCRIPT ERROR even if listed criteria pass", () => {
  const report = parseTestReport(
    "0. [FAIL] SCRIPT ERROR: Invalid get index\n1. [PASS] canvas visible\nOVERALL: FAIL",
  );
  assert.equal(report.overallPass, false);
  assert.equal(report.hasFailure, true);
  assert.equal(report.criteria[0]?.index, 0);
  assert.equal(report.criteria[0]?.status, "FAIL");
});

test("parseTestReport fails overall when implicit criterion 0 is missing", () => {
  const report = parseTestReport("1. [PASS] canvas\n2. [PASS] jump\nOVERALL: PASS");
  assert.equal(report.overallPass, false);
  assert.equal(report.hasFailure, true);
});

test("parseTestReport fails overall when criterion 0 is COULD NOT VERIFY", () => {
  const report = parseTestReport(
    "0. [COULD NOT VERIFY] console unread\n1. [PASS] canvas\nOVERALL: PASS",
  );
  assert.equal(report.overallPass, false);
  assert.equal(report.hasFailure, true);
});

test("ensureImplicitConsoleCriterion prepends a FAIL when listed checks omit criterion 0", () => {
  const raw = "1. [PASS] canvas\nOVERALL: PASS";
  const ensured = ensureImplicitConsoleCriterion(raw);
  assert.equal(ensured, `${MISSING_CONSOLE_CRITERION_LINE}\n${raw}`);
  const parsed = parseTestReport(ensured);
  assert.equal(parsed.overallPass, false);
  assert.equal(parsed.criteria[0]?.index, 0);
  assert.equal(parsed.criteria[0]?.status, "FAIL");
  assert.equal(ensureImplicitConsoleCriterion("no criteria here"), "no criteria here");
  const withZero = "0. [PASS] no SCRIPT ERROR in console\n1. [PASS] canvas";
  assert.equal(ensureImplicitConsoleCriterion(withZero), withZero);
});

test("parseTestReport treats listed could not verify as overall PASS when criterion 0 passed", () => {
  const unverified = parseTestReport(
    "0. [PASS] no SCRIPT ERROR in console\n1. [PASS] canvas\n2. [COULD NOT VERIFY] projectile too fast\nOVERALL: PASS",
  );
  assert.equal(unverified.overallPass, true);
  assert.equal(unverified.hasFailure, false);
  assert.equal(unverified.criteria.length, 3);
  assert.equal(unverified.criteria[2]?.status, "COULD_NOT_VERIFY");
  assert.equal(unverifiedCount(unverified), 1);
  assert.equal(unverifiedCount(parseTestReport("0. [PASS] no SCRIPT ERROR in console\n1. [PASS] canvas")), 0);
  const mixed = parseTestReport(
    "0. [PASS] no SCRIPT ERROR in console\n1. [FAIL] hud missing\n2. [COULD NOT VERIFY] projectile",
  );
  assert.equal(mixed.hasFailure, true);
  assert.equal(mixed.overallPass, false);
});

test("listCriterionScreenshots keeps only criterion-1..N in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-criterion-shots-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "page-viewport.png"), "dump");
  writeFileSync(join(dir, "criterion-0.png"), "console");
  writeFileSync(join(dir, "criterion-2.png"), "two");
  writeFileSync(join(dir, "criterion-1.png"), "one");
  writeFileSync(join(dir, "criterion-9.png"), "extra");
  assert.deepEqual(listCriterionScreenshots(dir), ["criterion-1.png", "criterion-2.png"]);
  assert.equal(MAX_ACCEPTANCE_CRITERIA, 3);
});
