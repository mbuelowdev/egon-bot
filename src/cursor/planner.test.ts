import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { plannerPrompt } from "./planner.js";
import { PLANNER_INSTRUCTIONS, plannerUserPrompt } from "./plannerPrompt.js";
import { SPEC_SHEET_TEMPLATE } from "./specTemplate.js";
import { TESTER_CAPABILITIES_PROMPT } from "./testerCapabilities.js";

test("cursor planner prompt is the shared instructions plus the user prompt", () => {
  const feature = { name: "Dash" } as Feature;
  const notes = ["make it snappy"];
  const user = plannerUserPrompt(feature, notes, "/data/attachments", []);
  const prompt = plannerPrompt(feature, notes, "/data/attachments", []);
  assert.equal(prompt, `${PLANNER_INSTRUCTIONS}\n\n${user}`);
  assert.doesNotMatch(prompt, /about 64000 tokens/);
  assert.doesNotMatch(prompt, /Do not use Bash, subagents, or the web/);
  assert.doesNotMatch(prompt, /Do not draft the entire SPEC in thinking/);
});

test("planner prompt requires a specific spec and clarifying questions", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Make the spec as specific as possible/);
  assert.match(prompt, /You are operating autonomously/);
  assert.match(prompt, /Batch independent Reads\/Glob\/Grep in one turn/);
  assert.match(prompt, /check your last paragraph/);
  assert.match(prompt, /at most 2 rounds, 5 questions total; if a detail stays unanswered use the stated default/);
  assert.match(prompt, /Never invent unspecified/);
  assert.match(prompt, /GAME_DECISIONS/);
  assert.match(prompt, /set `topic` to art-style, camera, control-scheme, or palette/);
  assert.match(prompt, /ask_discord_users ONCE/);
  assert.match(prompt, /array of every independent question/);
  assert.match(prompt, /PLAN_COMPLETE or PLAN_BLOCKED/);
  assert.match(prompt, /Do not end with PLAN_BLOCKED because a detail was unanswered/);
  assert.doesNotMatch(prompt, /If you need a human decision/);
});

test("planner prompt injects the game map", () => {
  const prompt = plannerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
  );
  assert.match(prompt, /Prefer this over Glob\/Grep\/Read/);
  assert.match(prompt, /Viewport: 99x99/);
});

test("planner prompt injects settled game decisions", () => {
  const prompt = plannerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
    "# Game decisions\n\n## Art style\n\npixel\n",
  );
  assert.match(prompt, /Do not re-ask Discord/);
  assert.match(prompt, /## Art style/);
  assert.match(prompt, /pixel/);
});

test("planner prompt includes the spec sheet template", () => {
  const fromDisk = readFileSync(join(process.cwd(), "templates", "spec-sheet.md"), "utf8").trim();
  assert.equal(SPEC_SHEET_TEMPLATE, fromDisk);
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  const user = plannerUserPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Follow the spec sheet template/);
  assert.ok(PLANNER_INSTRUCTIONS.includes(SPEC_SHEET_TEMPLATE));
  assert.ok(prompt.includes(SPEC_SHEET_TEMPLATE));
  assert.ok(!user.includes(SPEC_SHEET_TEMPLATE));
  assert.match(prompt, /## 1\. Context & Goal/);
  assert.match(prompt, /## 2\. Scope/);
  assert.match(prompt, /## 4\. Interface \/ Contract/);
  assert.match(prompt, /## 6\. Verification hooks/);
  assert.match(prompt, /window\.__egon\.state\(\)/);
  assert.match(prompt, /## 7\. Acceptance criteria/);
  assert.match(prompt, /Keys: \{KeyW \/ none\}/);
  assert.match(prompt, /Click: \{x,y \/ none\}/);
  assert.match(prompt, /## 8\. Explicitly NOT this task/);
  assert.match(prompt, /Section 6 \(Verification hooks\)/);
  assert.match(prompt, /Section 7 \(Acceptance criteria\)/);
  assert.match(prompt, /Section 8 may be a short don't-do list/);
  assert.match(prompt, /not a pixel guess/);
});

test("planner prompt is static-first then feature-specific", () => {
  const prompt = plannerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
    "# Game decisions\n\n## Art style\n\npixel\n",
  );
  const templateAt = prompt.indexOf(SPEC_SHEET_TEMPLATE);
  const mapAt = prompt.indexOf("Viewport: 99x99");
  const decisionsAt = prompt.indexOf("## Art style");
  const nameAt = prompt.indexOf("Feature name: Dash");
  const specAt = prompt.indexOf("docs/features/dash/SPEC.md");
  const notesAt = prompt.indexOf("make it snappy");
  const user = plannerUserPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
    "# Game decisions\n\n## Art style\n\npixel\n",
  );
  assert.ok(templateAt >= 0);
  assert.ok(!user.includes(SPEC_SHEET_TEMPLATE));
  assert.ok(templateAt < mapAt);
  assert.ok(mapAt < decisionsAt);
  assert.ok(decisionsAt < nameAt);
  assert.ok(nameAt < specAt);
  assert.ok(specAt < notesAt);
});

test("planner prompts share a static prefix across features", () => {
  const gameMap = "# Game map\n\n- Viewport: 99x99\n";
  const decisions = "# Game decisions\n\n## Art style\n\npixel\n";
  const dash = plannerPrompt({ name: "Dash" } as Feature, ["a"], "/data/a", [], gameMap, decisions);
  const jump = plannerPrompt({ name: "Jump" } as Feature, ["b"], "/data/b", [], gameMap, decisions);
  const prefixEnd = dash.indexOf("Feature name:");
  assert.ok(prefixEnd > 0);
  assert.equal(dash.slice(0, prefixEnd), jump.slice(0, prefixEnd));
  assert.ok(dash.slice(0, prefixEnd).includes(SPEC_SHEET_TEMPLATE));
  assert.ok(dash.slice(0, prefixEnd).includes(TESTER_CAPABILITIES_PROMPT));
  assert.ok(dash.slice(0, prefixEnd).includes("Viewport: 99x99"));
  assert.ok(dash.slice(0, prefixEnd).includes("## Art style"));
});
