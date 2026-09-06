import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAcceptanceCriteria, parseTestReport } from "./testReport.js";

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

test("parseTestReport overall PASS only if every criterion passes", () => {
  const pass = parseTestReport("1. [PASS] canvas\n2. [PASS] jump\nOVERALL: PASS");
  assert.equal(pass.overallPass, true);
  assert.equal(pass.criteria.length, 2);
  const fail = parseTestReport("1. [PASS] canvas\n2. [FAIL] jump is broken");
  assert.equal(fail.overallPass, false);
  assert.equal(parseTestReport("no criteria here").overallPass, false);
});
