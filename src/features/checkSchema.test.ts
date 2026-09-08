import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PROOF,
  DEFAULT_RECORD_MS,
  MAX_CHECKS,
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  checkScenarioNames,
  checkStateFields,
  parseChecksFile,
} from "./checkSchema.js";

function checks(steps: unknown[], scenario = "default"): string {
  return JSON.stringify([{ name: "a check", scenario, steps }]);
}

function problems(raw: string): string[] {
  const parsed = parseChecksFile(raw);
  assert.equal(parsed.ok, false);
  return parsed.ok === false ? parsed.problems : [];
}

test("a well-formed checks file parses into typed steps", () => {
  const parsed = parseChecksFile(
    checks([
      { await: "window.__egon.state().screen", equals: "victory" },
      { press: "Space" },
      { click: [480, 270] },
      { drag: [[10, 10], [20, 20]] },
      { expect: "window.__egon.state().score", at_least: 10 },
      { screenshot: "victory-score" },
    ]),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.checks.length, 1);
  assert.equal(parsed.checks[0]?.proof, DEFAULT_PROOF);
  assert.equal(parsed.checks[0]?.recordMs, DEFAULT_RECORD_MS);
  assert.deepEqual(
    parsed.checks[0]?.steps.map((step) => step.kind),
    ["await", "press", "click", "drag", "expect", "screenshot"],
  );
  assert.deepEqual(checkScenarioNames(parsed.checks), ["default"]);
  assert.deepEqual(checkStateFields(parsed.checks), ["score", "screen"]);
});

test("await gets a default timeout and expect may not carry one", () => {
  const parsed = parseChecksFile(checks([{ await: "window.__egon.state().ready", equals: true }]));
  assert.equal(parsed.ok, true);
  const step = parsed.ok ? parsed.checks[0]?.steps[0] : undefined;
  assert.equal(step?.kind, "await");
  assert.ok(step?.kind === "await" && step.timeoutMs > 0);
  assert.ok(
    problems(
      checks([{ expect: "window.__egon.state().ready", equals: true, timeout_ms: 500 }]),
    ).some((p) => /timeout_ms only applies to await/.test(p)),
  );
});

test("a sleep-shaped step is rejected outright", () => {
  // A suite built on frame timing is a flaky suite.
  for (const banned of [{ sleep: 500 }, { wait_ms: 500 }, { delay: 500 }]) {
    assert.ok(
      problems(checks([banned, { expect: "window.__egon.state().ready", equals: true }])).some((p) =>
        /Waiting is always a condition/.test(p),
      ),
    );
  }
});

test("coordinates outside the runner viewport are rejected", () => {
  assert.ok(
    problems(checks([{ click: [1000, 270] }, { expect: "window.__egon.state().x", equals: 1 }])).some(
      (p) => /fall outside the 960x540 viewport/.test(p),
    ),
  );
  assert.ok(
    problems(checks([{ click: [10.5, 20] }, { expect: "window.__egon.state().x", equals: 1 }])).some(
      (p) => /whole numbers/.test(p),
    ),
  );
});

test("a known-bad key spelling is corrected before any agent runs on it", () => {
  assert.ok(
    problems(checks([{ press: "spacebar" }, { expect: "window.__egon.state().x", equals: 1 }])).some(
      (p) => /use "Space"/.test(p),
    ),
  );
});

test("an expression that never reads the bridge is rejected", () => {
  assert.ok(
    problems(checks([{ expect: "document.title", equals: "Game" }])).some((p) =>
      /must read window.__egon.state\(\)/.test(p),
    ),
  );
});

test("a step needs exactly one kind and one comparator", () => {
  assert.ok(
    problems(checks([{ press: "Space", click: [1, 1] }])).some((p) =>
      /more than one step kind/.test(p),
    ),
  );
  assert.ok(
    problems(checks([{ expect: "window.__egon.state().x", equals: 1, at_least: 2 }])).some((p) =>
      /more than one comparator/.test(p),
    ),
  );
  assert.ok(
    problems(checks([{ expect: "window.__egon.state().x" }])).some((p) =>
      /needs exactly one comparator/.test(p),
    ),
  );
});

test("changed_by without an earlier read of the same expression is rejected", () => {
  // The runner compares against the previous reading; with none, there is nothing to
  // subtract from, and the check would fail at runtime for a reason the planner controls.
  assert.ok(
    problems(checks([{ press: "Space" }, { expect: "window.__egon.state().x", changed_by: 80 }])).some(
      (p) => /without an earlier read of the same expression/.test(p),
    ),
  );
  const ok = parseChecksFile(
    checks([
      { expect: "window.__egon.state().x", at_least: 0 },
      { press: "Space" },
      { expect: "window.__egon.state().x", changed_by: 80 },
    ]),
  );
  assert.equal(ok.ok, true);
});

test("a check that never asserts is rejected", () => {
  assert.ok(
    problems(checks([{ press: "Space" }, { screenshot: "shot" }])).some((p) =>
      /never asserts anything/.test(p),
    ),
  );
});

test("scenario names must be lower_snake_case and present", () => {
  assert.ok(
    problems(checks([{ expect: "window.__egon.state().x", equals: 1 }], "Endgame Victory")).some(
      (p) => /lower_snake_case/.test(p),
    ),
  );
  assert.ok(
    problems(checks([{ expect: "window.__egon.state().x", equals: 1 }], "")).some((p) =>
      /must name a scenario/.test(p),
    ),
  );
});

test("the file must be a non-empty array within the check cap", () => {
  assert.ok(problems("{}").some((p) => /must be a JSON array/.test(p)));
  assert.ok(problems("[]").some((p) => /at least one check/.test(p)));
  assert.ok(problems("not json").some((p) => /not valid JSON/.test(p)));
  const many = JSON.stringify(
    Array.from({ length: MAX_CHECKS + 1 }, (_, i) => ({
      name: `check ${String(i)}`,
      scenario: "default",
      steps: [{ expect: "window.__egon.state().x", equals: 1 }],
    })),
  );
  assert.ok(problems(many).some((p) => new RegExp(`at most ${String(MAX_CHECKS)}`).test(p)));
});

test("two checks may not share a name", () => {
  const raw = JSON.stringify([
    { name: "same", scenario: "default", steps: [{ expect: "window.__egon.state().x", equals: 1 }] },
    { name: "same", scenario: "default", steps: [{ expect: "window.__egon.state().x", equals: 2 }] },
  ]);
  assert.ok(problems(raw).some((p) => /share the name/.test(p)));
});

test("proof defaults to screenshot and video may set record_ms", () => {
  const video = parseChecksFile(
    JSON.stringify([
      {
        name: "dash motion",
        scenario: "default",
        proof: "video",
        record_ms: 6000,
        steps: [{ expect: "window.__egon.state().dashesStarted", at_least: 1 }],
      },
    ]),
  );
  assert.equal(video.ok, true);
  assert.equal(video.ok ? video.checks[0]?.proof : undefined, "video");
  assert.equal(video.ok ? video.checks[0]?.recordMs : undefined, 6000);
});

test("record_ms is rejected on screenshot proof and out of range on video", () => {
  const withRecord = JSON.stringify([
    {
      name: "hud",
      scenario: "default",
      proof: "screenshot",
      record_ms: 8000,
      steps: [{ expect: "window.__egon.state().x", equals: 1 }],
    },
  ]);
  assert.ok(problems(withRecord).some((p) => /record_ms only applies when proof is "video"/.test(p)));
  const tooLong = JSON.stringify([
    {
      name: "dash",
      scenario: "default",
      proof: "video",
      record_ms: MAX_RECORD_MS + 1,
      steps: [{ expect: "window.__egon.state().x", equals: 1 }],
    },
  ]);
  assert.ok(problems(tooLong).some((p) => new RegExp(String(MIN_RECORD_MS)).test(p)));
  const badKind = JSON.stringify([
    {
      name: "dash",
      scenario: "default",
      proof: "gif",
      steps: [{ expect: "window.__egon.state().x", equals: 1 }],
    },
  ]);
  assert.ok(problems(badKind).some((p) => /proof must be "screenshot" or "video"/.test(p)));
});
