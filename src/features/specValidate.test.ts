import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ACCEPTANCE_CRITERIA } from "../cursor/testReport.js";
import { SPEC_SHEET_TEMPLATE } from "../cursor/specTemplate.js";
import {
  countNumberedCriteria,
  declaredScenarioNames,
  requiredSpecHeadings,
  specFixFollowUp,
  specGateFailureMessage,
  templatePlaceholders,
  validateFeatureSpec,
  validatePlannerOutput,
} from "./specValidate.js";

/** Realistic Verification hooks: the gate requires the bridge named and its fields declared. */
const VERIFICATION_HOOKS = [
  '- Mechanism: `get_node("/root/EgonBridge").register_field("playerX", func(): return global_position.x)`.',
  "- Call: `window.__egon.state()` returns JSON.",
  "- Fields this feature registers:",
  "  - `playerX` (`number`) — the player's x position.",
].join("\n");

const TEST_SCENARIOS = [
  "- Scenarios this feature verifies against:",
  "  - `default` (existing) — the game as it normally boots.",
].join("\n");

const ASSETS = [
  "- `garbage-truck-orange.glb` — parked at the depot spawn point; scale to 1.0, the bbox is already metres.",
].join("\n");

function spec(options?: {
  criteria?: string[];
  scenarios?: string;
  hooks?: string;
  assets?: string;
}): string {
  const criteria = options?.criteria ?? [
    "The player dashes 80 pixels to the right when Space is tapped.",
    "The HUD shows the remaining dash charges.",
  ];
  const numbered = criteria.map((line, i) => `${String(i + 1)}. ${line}`).join("\n");
  const chunks = ["# Dash", ""];
  for (const heading of requiredSpecHeadings()) {
    chunks.push(heading, "");
    if (heading.endsWith("Acceptance criteria")) {
      chunks.push(numbered === "" ? "Write some criteria." : numbered, "");
    } else if (heading.endsWith("Test scenarios")) {
      chunks.push(options?.scenarios ?? TEST_SCENARIOS, "");
    } else if (heading.endsWith("Verification hooks")) {
      chunks.push(options?.hooks ?? VERIFICATION_HOOKS, "");
    } else if (heading.endsWith("Assets")) {
      chunks.push(options?.assets ?? "None.", "");
    } else {
      chunks.push("Filled.", "");
    }
  }
  return chunks.join("\n");
}

const CHECKS = JSON.stringify([
  {
    name: "dash moves the player right",
    scenario: "default",
    steps: [
      { expect: "window.__egon.state().playerX", equals: 0 },
      { press: "Space" },
      { expect: "window.__egon.state().playerX", at_least: 80 },
    ],
  },
]);

test("template headings and placeholders are extracted from the spec sheet", () => {
  // Asserted by name, not by number: the template gets renumbered when a section is
  // added, and the parsers match on the name with the number optional.
  const headings = requiredSpecHeadings();
  const names = headings.map((heading) => heading.replace(/^#+\s*(?:\d+\.\s*)?/, ""));
  assert.deepEqual(names, [
    "Context & Goal",
    "Scope",
    "In scope",
    "Out of scope",
    "Relevant files / existing code",
    "Files to modify",
    "Files to create",
    "Existing patterns / conventions",
    "Assets",
    "Interface / Contract",
    "Implementation notes / constraints",
    "Verification hooks",
    "Test scenarios",
    "Acceptance criteria",
    "Explicitly NOT this task",
  ]);
  assert.ok(templatePlaceholders().length > 0);
  // `{field}` / `{expression}` used to appear in the EgonBridge mechanism line. The
  // planner copies that sentence, so treating them as fill-in tokens always failed the gate.
  assert.ok(!templatePlaceholders().includes("{field}"));
  assert.ok(!templatePlaceholders().includes("{expression}"));
});

test("copying the template's EgonBridge mechanism sentence is not a leftover placeholder", () => {
  const mechanism = SPEC_SHEET_TEMPLATE.split("\n").find((line) => line.includes("register_field"));
  assert.ok(mechanism);
  const result = validateFeatureSpec(
    spec({
      hooks: [
        mechanism,
        "- Call: `window.__egon.state()` returns JSON.",
        "- Fields this feature registers:",
        "  - `playerX` (`number`) — the player's x position.",
      ].join("\n"),
    }),
  );
  assert.equal(result.ok, true, result.ok === false ? result.problems.join("\n") : "");
});

test("a filled spec with plain-language criteria and a scenario passes", () => {
  const markdown = spec();
  assert.equal(countNumberedCriteria(markdown), 2);
  assert.deepEqual(validateFeatureSpec(markdown), { ok: true });
  assert.deepEqual(validatePlannerOutput({ markdown, checksRaw: CHECKS }), { ok: true });
});

test("a spec whose Assets section names a library asset passes", () => {
  const markdown = spec({ assets: ASSETS });
  assert.deepEqual(
    validatePlannerOutput({
      markdown,
      checksRaw: CHECKS,
      libraryAssetIds: ["garbage-truck-orange.glb", "grass-plain.png"],
    }),
    { ok: true },
  );
});

test("an Assets section naming an id the library does not have is rejected", () => {
  const markdown = spec({ assets: "- `garbage-truck.glb` — the truck the planner hoped existed." });
  const result = validatePlannerOutput({
    markdown,
    checksRaw: CHECKS,
    libraryAssetIds: ["garbage-truck-orange.glb"],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.problems.some((problem) => /`garbage-truck\.glb`, which is not a described asset/.test(problem)),
    );
  }
});

test("an undescribed asset is not a name a spec may use", () => {
  // Undescribed assets never reach the manifest, so an id for one was guessed.
  const markdown = spec({ assets: ASSETS });
  const result = validatePlannerOutput({ markdown, checksRaw: CHECKS, libraryAssetIds: [] });
  assert.equal(result.ok, false);
});

test("`None.` in the Assets section validates cleanly against an empty library", () => {
  assert.deepEqual(
    validatePlannerOutput({ markdown: spec(), checksRaw: CHECKS, libraryAssetIds: [] }),
    { ok: true },
  );
});

test("acceptance criteria carrying the retired Keys/Click/JS/Then grammar are rejected", () => {
  // Steps live in the checks file now. A criterion that still scripts the runner means
  // the planner put the test plan in the wrong file.
  const result = validateFeatureSpec(
    spec({
      criteria: [
        "Keys: Space. Click: none. JS: `() => window.__egon.state().playerX`. Then: at least 80.",
      ],
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /plain-language definition of done/.test(p)));
});

test("a spec that names no scenario is rejected", () => {
  const result = validateFeatureSpec(spec({ scenarios: "We will test it somehow." }));
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /names no scenario/.test(p)));
});

test("more than three numbered criteria is rejected", () => {
  const many = Array.from({ length: MAX_ACCEPTANCE_CRITERIA + 1 }, (_, i) => `Criterion ${String(i)}.`);
  const result = validateFeatureSpec(spec({ criteria: many }));
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /at most 3 are allowed/.test(p)));
});

test("leftover {placeholder} tokens fail even when headings and criteria are present", () => {
  const markdown = `${spec()}\n\n{what it represents}\n`;
  const result = validateFeatureSpec(markdown);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => p.startsWith("Leftover template placeholder")));
});

test("headings present but out of order fail", () => {
  const lines = spec().split("\n");
  const a = lines.findIndex((line) => line.endsWith("Verification hooks"));
  const b = lines.findIndex((line) => line.endsWith("Interface / Contract"));
  [lines[a], lines[b]] = [lines[b] ?? "", lines[a] ?? ""];
  const result = validateFeatureSpec(lines.join("\n"));
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.includes("Required headings are out of order"));
});

test("a missing checks file is a gate failure, not a pass", () => {
  const result = validatePlannerOutput({ markdown: spec() });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /did not write the checks file/.test(p)));
});

test("a check reading a field Verification hooks never declares is rejected", () => {
  const checks = JSON.stringify([
    {
      name: "score rises",
      scenario: "default",
      steps: [{ expect: "window.__egon.state().score", equals: 10 }],
    },
  ]);
  const result = validatePlannerOutput({ markdown: spec(), checksRaw: checks });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /never declares a `score` field/.test(p)));
});

test("a check naming an unregistered, undeclared scenario is rejected", () => {
  const checks = JSON.stringify([
    {
      name: "victory screen",
      scenario: "endgame_victory",
      steps: [{ expect: "window.__egon.state().playerX", equals: 0 }],
    },
  ]);
  const result = validatePlannerOutput({ markdown: spec(), checksRaw: checks });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /endgame_victory/.test(p)));
});

test("a scenario the spec declares in Test scenarios counts as known", () => {
  const markdown = spec({
    scenarios: "- `endgame_victory` (new) — the victory screen after a full run.",
  });
  assert.deepEqual(declaredScenarioNames(markdown), ["endgame_victory"]);
  const checks = JSON.stringify([
    {
      name: "victory screen",
      scenario: "endgame_victory",
      steps: [{ expect: "window.__egon.state().playerX", equals: 0 }],
    },
  ]);
  assert.deepEqual(validatePlannerOutput({ markdown, checksRaw: checks }), { ok: true });
});

test("a scenario the game already registers counts as known", () => {
  const checks = JSON.stringify([
    {
      name: "victory screen",
      scenario: "endgame_victory",
      steps: [{ expect: "window.__egon.state().playerX", equals: 0 }],
    },
  ]);
  assert.deepEqual(
    validatePlannerOutput({
      markdown: spec(),
      checksRaw: checks,
      knownScenarios: ["endgame_victory"],
    }),
    { ok: true },
  );
});

test("verification hooks that never name the shipped bridge are rejected", () => {
  const result = validatePlannerOutput({
    markdown: spec({ hooks: "- Expose a global called `window.myGame`." }),
    checksRaw: CHECKS,
  });
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.problems.some((p) => /EgonBridge/.test(p)));
});

test("the repair follow-up spells out both files and the no-sleep rule", () => {
  const text = specFixFollowUp(["Check 1 step 2 names no step kind"]);
  assert.match(text, /the spec file and the checks file/);
  assert.match(text, /Check 1 step 2 names no step kind/);
  assert.match(text, /Waiting is always a condition/);
  assert.match(text, /proof is screenshot or video/);
  assert.match(text, /PLAN_COMPLETE/);
  assert.match(specGateFailureMessage(["nope"]), /failed schema check/);
});
