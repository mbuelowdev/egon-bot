import assert from "node:assert/strict";
import { test } from "node:test";
import { SPEC_SHEET_TEMPLATE } from "../cursor/specTemplate.js";
import { MAX_ACCEPTANCE_CRITERIA } from "../cursor/testReport.js";
import {
  countNumberedCriteria,
  requiredSpecHeadings,
  specFixFollowUp,
  specGateFailureMessage,
  templatePlaceholders,
  validateFeatureSpec,
} from "./specValidate.js";

function minimalValidSpec(
  criteria = [
    "Keys: Space. JS: `() => window.__egon.state().playerX`. Then: return increased by at least 80.",
    "Keys: none. JS: `() => window.__egon.state()`. Then: playerX is a number.",
  ],
): string {
  const numbered = criteria.map((line, i) => `${String(i + 1)}. ${line}`).join("\n");
  const chunks = ["# Dash", ""];
  for (const heading of requiredSpecHeadings()) {
    chunks.push(heading, "");
    if (heading === "## 7. Acceptance criteria") {
      chunks.push(numbered === "" ? "Write some checks." : numbered, "");
    } else {
      chunks.push("Filled.", "");
    }
  }
  return chunks.join("\n");
}

test("template headings and placeholders are extracted from the spec sheet", () => {
  const headings = requiredSpecHeadings();
  assert.deepEqual(headings, [
    "## 1. Context & Goal",
    "## 2. Scope",
    "### In scope",
    "### Out of scope",
    "## 3. Relevant files / existing code",
    "### Files to modify",
    "### Files to create",
    "### Existing patterns / conventions",
    "## 4. Interface / Contract",
    "## 5. Implementation notes / constraints",
    "## 6. Verification hooks",
    "## 7. Acceptance criteria",
    "## 8. Explicitly NOT this task",
  ]);
  const placeholders = templatePlaceholders();
  assert.ok(placeholders.includes("{Feature name}"));
  assert.ok(placeholders.includes("{path}"));
  assert.ok(placeholders.includes("{…}"));
  assert.ok(placeholders.includes("{expected JSON}"));
  assert.ok(placeholders.includes("{x,y / none}"));
  assert.equal(MAX_ACCEPTANCE_CRITERIA, 3);
});

test("a filled spec with template headings and two numbered criteria passes", () => {
  const spec = minimalValidSpec();
  assert.equal(validateFeatureSpec(spec).ok, true);
  assert.equal(countNumberedCriteria(spec), 2);
});

test("JSON braces in Then clauses are not leftover placeholders", () => {
  const spec = minimalValidSpec([
    'Keys: none. JS: `() => window.__egon.state()`. Then: `{ "playerX": 0 }`.',
  ]);
  assert.equal(validateFeatureSpec(spec).ok, true);
});

test("the unfilled spec sheet template fails on leftover placeholders", () => {
  const result = validateFeatureSpec(SPEC_SHEET_TEMPLATE);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.problems.some((problem) => problem.startsWith("Leftover template placeholder:")));
  assert.ok(result.problems.some((problem) => problem.includes("{Feature name}")));
});

test("custom headings like a historical one-off spec fail the heading gate", () => {
  const spec = [
    "# Catch the orb",
    "",
    "## Goal",
    "",
    "The player can catch a projectile.",
    "",
    "## What to build",
    "",
    "An orb that flies across the screen.",
    "",
    "## Acceptance criteria",
    "",
    "1. Keys: none. JS: `() => window.__egon.state()`. Then: game loaded.",
    "2. Keys: Space. JS: `() => window.__egon.state().caught`. Then: true while the orb is mid-flight.",
    "3. Keys: Space. JS: `() => window.__egon.state().caught`. Then: true on the single frame the projectile overlaps the player.",
    "",
  ].join("\n");
  const result = validateFeatureSpec(spec);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.problems.some((problem) => problem === "Missing heading: ## 1. Context & Goal"));
  assert.ok(result.problems.some((problem) => problem === "Missing heading: ## 4. Interface / Contract"));
  assert.ok(result.problems.some((problem) => problem === "Missing heading: ## 7. Acceptance criteria"));
  assert.equal(
    result.problems.some((problem) => problem.includes("numbered items")),
    false,
  );
  assert.equal(countNumberedCriteria(spec), 3);
});

test("more than three numbered criteria is rejected", () => {
  const spec = minimalValidSpec(["one", "two", "three", "four"]);
  const result = validateFeatureSpec(spec);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(result.problems, [
    "Acceptance criteria has 4 numbered items; at most 3 are allowed",
  ]);
});

test("zero numbered criteria is rejected", () => {
  const spec = minimalValidSpec([]);
  const result = validateFeatureSpec(spec);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(
    result.problems.includes(
      "Acceptance criteria must be a numbered list of at most 3 items (found none)",
    ),
  );
});

test("leftover {placeholder} tokens fail even when headings and criteria are present", () => {
  const spec = minimalValidSpec().replace("# Dash", "# {Feature name}");
  const result = validateFeatureSpec(spec);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(result.problems, ["Leftover template placeholder: {Feature name}"]);
});

test("headings present but out of order fail", () => {
  const spec = minimalValidSpec()
    .replace("## 1. Context & Goal", "## 1. TEMP")
    .replace("## 8. Explicitly NOT this task", "## 1. Context & Goal")
    .replace("## 1. TEMP", "## 8. Explicitly NOT this task");
  const result = validateFeatureSpec(spec);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.ok(result.problems.includes("Required headings are out of order"));
});

test("specFixFollowUp lists every problem for one targeted retry", () => {
  const followUp = specFixFollowUp([
    "Missing heading: ## 4. Interface / Contract",
    "Acceptance criteria has 4 numbered items; at most 3 are allowed",
  ]);
  assert.match(followUp, /deterministic schema check/);
  assert.match(followUp, /Missing heading: ## 4\. Interface \/ Contract/);
  assert.match(followUp, /4 numbered items/);
  assert.match(followUp, /PLAN_COMPLETE/);
  assert.match(specGateFailureMessage(["Missing heading: ## 4. Interface / Contract"]), /schema check/);
});
