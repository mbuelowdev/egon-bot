import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTestReport } from "../cursor/testReport.js";
import { regressionFailures, renderSuiteReport, suitePassed, type SuiteCheckResult } from "./report.js";

function check(overrides: Partial<SuiteCheckResult> = {}): SuiteCheckResult {
  return {
    name: "dash moves the player right",
    scenario: "default",
    owner: "dash",
    inherited: false,
    ok: true,
    screenshots: [],
    ...overrides,
  };
}

test("a passing suite renders a report the existing parser understands", () => {
  const result = { results: [check()], scriptErrors: [], consoleErrors: [] };
  const raw = renderSuiteReport(result);
  assert.equal(suitePassed(result), true);
  assert.match(raw, /^0\. \[PASS\] no SCRIPT ERROR in console$/m);
  assert.match(raw, /^1\. \[PASS\] dash moves the player right \(scenario: default\)$/m);
  assert.match(raw, /OVERALL: PASS/);
  // The rest of the pipeline parses this, so the shape has to survive a round trip.
  const parsed = parseTestReport(raw);
  assert.equal(parsed.overallPass, true);
  assert.equal(parsed.criteria.length, 2);
});

test("a failing check carries the step, expected, and actual into the report", () => {
  const result = {
    results: [
      check({
        ok: false,
        failedStep: 3,
        failure: "expect window.__egon.state().score equals 4200 — expected 4200, actual 0",
      }),
    ],
    scriptErrors: [],
    consoleErrors: [],
  };
  const raw = renderSuiteReport(result);
  assert.equal(suitePassed(result), false);
  assert.match(raw, /1\. \[FAIL\] dash moves the player right/);
  assert.match(raw, /step 3: expect window\.__egon\.state\(\)\.score equals 4200/);
  assert.match(raw, /expected 4200, actual 0/);
  assert.match(raw, /OVERALL: FAIL/);
  assert.equal(parseTestReport(raw).overallPass, false);
});

test("a SCRIPT ERROR fails the run even when every check passed", () => {
  const result = {
    results: [check()],
    scriptErrors: ["SCRIPT ERROR: Invalid access on null instance"],
    consoleErrors: ["SCRIPT ERROR: Invalid access on null instance"],
  };
  const raw = renderSuiteReport(result);
  assert.equal(suitePassed(result), false);
  assert.match(raw, /0\. \[FAIL\] SCRIPT ERROR in console/);
  assert.match(raw, /Invalid access on null instance/);
  assert.match(raw, /OVERALL: FAIL/);
  assert.equal(parseTestReport(raw).overallPass, false);
});

test("inherited checks are labelled and counted as regressions", () => {
  const result = {
    results: [
      check(),
      check({
        name: "victory screen shows the score",
        scenario: "endgame_victory",
        owner: "endgame-screen",
        inherited: true,
        ok: false,
        failedStep: 2,
        failure: "expected 4200, actual 0",
      }),
    ],
    scriptErrors: [],
    consoleErrors: [],
  };
  const raw = renderSuiteReport(result);
  assert.match(raw, /\(scenario: endgame_victory, inherited from endgame-screen\)/);
  assert.match(raw, /1 of 2 checks are regression checks/);
  assert.equal(regressionFailures(result).length, 1);
  assert.equal(suitePassed(result), false);
});

test("a suite that could not run at all reports FAIL, not a vacuous pass", () => {
  const result = {
    results: [],
    scriptErrors: [],
    consoleErrors: [],
    fatal: "no checks found in egon/checks for dash",
  };
  const raw = renderSuiteReport(result);
  assert.equal(suitePassed(result), false);
  assert.match(raw, /1\. \[FAIL\] the suite found no checks to run/);
  assert.match(raw, /could not run: no checks found/);
  assert.match(raw, /OVERALL: FAIL/);
});

test("COULD NOT VERIFY never appears — a step asserts or it fails", () => {
  const raw = renderSuiteReport({
    results: [check(), check({ name: "other", ok: false, failure: "nope" })],
    scriptErrors: [],
    consoleErrors: [],
  });
  assert.doesNotMatch(raw, /COULD NOT VERIFY/);
});
