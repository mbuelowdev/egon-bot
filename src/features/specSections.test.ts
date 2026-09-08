import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAcceptanceCriteria } from "../cursor/testReport.js";
import {
  acceptanceCriteriaSection,
  assetsSection,
  declaredAssetIds,
  markdownSection,
  numberedCriteria,
  verificationHooksSection,
} from "./specSections.js";

test("a sub-bullet under Acceptance criteria is prose, not a fourth criterion", () => {
  const spec = [
    "## 7. Acceptance criteria",
    "",
    "1. Keys: none. Click: none. JS: `() => window.__egon.state().a`. Then: 1.",
    "   - note: the HUD animates in over 200ms, so wait before reading.",
    "2. Keys: none. Click: none. JS: `() => window.__egon.state().b`. Then: 2.",
    "3. Keys: none. Click: none. JS: `() => window.__egon.state().c`. Then: 3.",
    "",
    "## 8. Explicitly NOT this task",
    "- None.",
  ].join("\n");
  // The gate and the tester's checklist must agree: counting the note as a criterion
  // used to push criterion 3 past the cap and shift criterion-N.png numbering.
  assert.equal(numberedCriteria(spec).length, 3);
  assert.deepEqual(
    parseAcceptanceCriteria(spec).map((line) => line.slice(-2)),
    ["1.", "2.", "3."],
  );
});

test("numberedCriteria returns nothing when Acceptance criteria is absent instead of scanning the document", () => {
  const spec = [
    "# Dash",
    "",
    "## 2. Scope",
    "",
    "1. build the dash",
    "2. add a cooldown",
    "3. tune the curve",
  ].join("\n");
  // Falling back to the whole document shipped Scope's list to the tester as the checklist.
  assert.deepEqual(numberedCriteria(spec), []);
  assert.deepEqual(parseAcceptanceCriteria(spec), []);
});

test("Acceptance criteria stops at the next same-level heading", () => {
  const spec = [
    "## 7. Acceptance criteria",
    "1. Keys: none. Click: none. JS: `() => window.__egon.state()`. Then: ok.",
    "",
    "## 8. Explicitly NOT this task",
    "1. do not touch the menu",
  ].join("\n");
  assert.equal(numberedCriteria(spec).length, 1);
});

test("Acceptance criteria keeps deeper headings inside the section", () => {
  const spec = ["## 7. Acceptance criteria", "", "### Notes", "", "1. a", "", "## 8. X", "1. b"].join("\n");
  assert.deepEqual(numberedCriteria(spec), ["a"]);
});

test("an unnumbered acceptance heading still resolves", () => {
  assert.notEqual(acceptanceCriteriaSection("## Acceptance criteria\n1. a\n"), undefined);
  assert.equal(acceptanceCriteriaSection("## Scope\n1. a\n"), undefined);
});

test("verificationHooksSection reads its own section and stops at the next one", () => {
  const spec = [
    "## 6. Verification hooks",
    "",
    "- Call: `window.__egon.state()` returns JSON.",
    "",
    "## 7. Acceptance criteria",
    "1. a",
  ].join("\n");
  const section = verificationHooksSection(spec) ?? "";
  assert.match(section, /window\.__egon\.state\(\)/);
  assert.doesNotMatch(section, /Acceptance criteria/);
});

test("markdownSection returns undefined for a heading that is not there", () => {
  assert.equal(markdownSection("# Dash\n\nbody\n", /^## nope$/i), undefined);
});

test("declaredAssetIds reads library ids off the Assets section's list items", () => {
  const markdown = [
    "## 4. Assets",
    "",
    "Library assets this feature uses, named by exact `id`. The implementer copies each one",
    "into `assets/library/{kind}/{id}` in the game repo.",
    "",
    "- `garbage-truck-orange.glb` — parked at the depot; the bbox is already metres.",
    "- `grass-plain.png` — ground tile under the depot, tiled 8 x 8.",
    "* `horn.ogg` — plays when the truck arrives.",
    "",
    "Placeholder art the implementer draws itself is not a library asset — put it in §6.",
    "",
    "## 5. Interface / Contract",
    "",
    "A `ColorRect` named `Cursor.tscn` is not an asset.",
  ].join("\n");
  assert.deepEqual(declaredAssetIds(markdown), [
    "garbage-truck-orange.glb",
    "grass-plain.png",
    "horn.ogg",
  ]);
});

test("an Assets section of `None.` declares nothing", () => {
  assert.deepEqual(declaredAssetIds("## Assets\n\nNone.\n\n## Interface / Contract\n"), []);
  assert.deepEqual(declaredAssetIds("# Dash\n\n## Scope\n\n- `a.png`\n"), []);
  assert.equal(assetsSection("## Assets\n\nNone.\n"), "\nNone.\n");
});

test("the Assets section stops at the next heading", () => {
  const markdown = "## 4. Assets\n\n- `a.png` — one\n\n## 5. Interface / Contract\n\n- `b.png` — two\n";
  assert.deepEqual(declaredAssetIds(markdown), ["a.png"]);
});
