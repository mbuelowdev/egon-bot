import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChecksFile, type Check } from "../features/checkSchema.js";
import { compareValues, runCheckSteps, runStep, type StepContext, type SuitePage } from "./steps.js";

function context(): StepContext {
  return {
    previous: new Map(),
    screenshots: [],
    screenshotName: (name, seen) => (seen === 0 ? "criterion-1.png" : `check-1-${name}.png`),
  };
}

/** A page whose bridge reads come from a scripted queue, one per settle-poll. */
function fakePage(values: unknown[], log: string[] = []): SuitePage {
  let index = 0;
  return {
    evaluate: async <T>() => {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      return { value, first: value, changed: false, settled: true, samples: 1, ms: 1 } as T;
    },
    press: async (key, holdMs) => {
      log.push(holdMs !== undefined ? `press:${key}:${String(holdMs)}` : `press:${key}`);
    },
    click: async (x, y) => {
      log.push(`click:${String(x)},${String(y)}`);
    },
    move: async (x, y) => {
      log.push(`move:${String(x)},${String(y)}`);
    },
    drag: async (from, to) => {
      log.push(`drag:${from.join(",")}->${to.join(",")}`);
    },
    screenshot: async (file) => {
      log.push(`shot:${file}`);
    },
    startProofVideo: async () => false,
    stopProofVideo: async () => false,
    wait: async (ms) => {
      log.push(`wait:${String(ms)}`);
    },
  };
}

function checkOf(steps: unknown[]): Check {
  const parsed = parseChecksFile(
    JSON.stringify([{ name: "a check", scenario: "default", steps }]),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error("fixture did not parse");
  }
  return parsed.checks[0] as Check;
}

test("compareValues implements every comparator", () => {
  assert.equal(compareValues("equals", 1, 1).ok, true);
  assert.equal(compareValues("equals", { a: 1 }, { a: 1 }).ok, true);
  assert.equal(compareValues("equals", 1, 2).ok, false);
  assert.equal(compareValues("at_least", 5, 5).ok, true);
  assert.equal(compareValues("at_least", 4, 5).ok, false);
  assert.equal(compareValues("at_most", 4, 5).ok, true);
  assert.equal(compareValues("contains", "victory screen", "victory").ok, true);
  assert.equal(compareValues("contains", ["a", "b"], "b").ok, true);
  assert.equal(compareValues("contains", 5, "b").ok, false);
});

test("changed_by needs a previous reading and compares the delta", () => {
  assert.equal(compareValues("changed_by", 180, 80, 100).ok, true);
  assert.equal(compareValues("changed_by", 150, 80, 100).ok, false);
  const missing = compareValues("changed_by", 180, 80);
  assert.equal(missing.ok, false);
  assert.match(missing.reason ?? "", /no earlier reading/);
});

test("a failing comparison reports expected and actual", () => {
  const verdict = compareValues("equals", 0, 4200);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason ?? "", /expected 4200, actual 0/);
});

test("input steps drive the page and report what ran", async () => {
  const log: string[] = [];
  const page = fakePage([], log);
  const ctx = context();
  const check = checkOf([
    { press: "Space" },
    { click: [480, 270] },
    { move: [10, 10] },
    { drag: [[1, 2], [3, 4]] },
    { screenshot: "shot" },
    { expect: "window.__egon.state().x", equals: 1 },
  ]);
  for (const step of check.steps.slice(0, 5)) {
    const outcome = await runStep(page, step, ctx);
    assert.equal(outcome.ok, true);
  }
  assert.deepEqual(log, [
    "press:Space",
    "click:480,270",
    "move:10,10",
    "drag:1,2->3,4",
    "shot:criterion-1.png",
  ]);
  assert.deepEqual(ctx.screenshots, ["criterion-1.png"]);
});

test("expect asserts once and fails with the reason", async () => {
  const check = checkOf([{ expect: "window.__egon.state().score", equals: 4200 }]);
  const outcome = await runCheckSteps(fakePage([0]), check, context());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failedStep, 1);
  assert.match(outcome.failure ?? "", /expected 4200, actual 0/);
});

test("await polls until the value matches instead of failing on the first read", async () => {
  const check = checkOf([{ await: "window.__egon.state().screen", equals: "victory" }]);
  const outcome = await runCheckSteps(fakePage(["loading", "loading", "victory"]), check, context());
  assert.equal(outcome.ok, true);
});

test("await gives up at its timeout and reports the last value", async () => {
  const check = checkOf([
    { await: "window.__egon.state().screen", equals: "victory", timeout_ms: 1 },
  ]);
  const outcome = await runCheckSteps(fakePage(["loading"]), check, context());
  assert.equal(outcome.ok, false);
  assert.match(outcome.failure ?? "", /expected "victory", actual "loading"/);
});

test("a check stops at its first failing step", async () => {
  const log: string[] = [];
  const check = checkOf([
    { expect: "window.__egon.state().x", equals: 999 },
    { press: "Space" },
  ]);
  const outcome = await runCheckSteps(fakePage([0], log), check, context());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failedStep, 1);
  assert.deepEqual(log, []);
});

test("a bridge read that throws fails the check with the error", async () => {
  const page: SuitePage = {
    ...fakePage([]),
    evaluate: async <T>() =>
      ({ value: null, first: null, changed: false, settled: false, samples: 1, ms: 1, error: "TypeError: undefined" }) as T,
  };
  const check = checkOf([{ expect: "window.__egon.state().x", equals: 1 }]);
  const outcome = await runCheckSteps(page, check, context());
  assert.equal(outcome.ok, false);
  assert.match(outcome.failure ?? "", /TypeError: undefined/);
});

test("changed_by uses the reading an earlier step recorded", async () => {
  const check = checkOf([
    { expect: "window.__egon.state().playerX", at_least: 0 },
    { press: "Space" },
    { expect: "window.__egon.state().playerX", changed_by: 80 },
  ]);
  const outcome = await runCheckSteps(fakePage([100, 180]), check, context());
  assert.equal(outcome.ok, true);
});

test("video-proof pacing holds a press and lingers after input", async () => {
  const log: string[] = [];
  const ctx = {
    ...context(),
    proofPressHoldMs: 750,
    proofActionGapMs: 400,
  };
  const check = checkOf([
    { press: "KeyW" },
    { click: [10, 20] },
    { expect: "window.__egon.state().ready", equals: true },
  ]);
  const outcome = await runCheckSteps(fakePage([true], log), check, ctx);
  assert.equal(outcome.ok, true);
  assert.deepEqual(log, ["press:KeyW:750", "wait:400", "click:10,20", "wait:400"]);
});
