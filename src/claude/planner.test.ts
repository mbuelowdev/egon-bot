import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { PLANNER_INSTRUCTIONS, plannerUserPrompt } from "../cursor/plannerPrompt.js";
import { SPEC_SHEET_TEMPLATE } from "../cursor/specTemplate.js";
import { RUNNER_CAPABILITIES_PROMPT } from "../suite/capabilities.js";
import { claudePlannerSystemPrompt, claudePlannerUserPrompt } from "./planner.js";

test("claude planner system prompt is identical and omits the spec path", () => {
  const prompt = claudePlannerSystemPrompt();
  assert.ok(prompt.startsWith(PLANNER_INSTRUCTIONS));
  assert.doesNotMatch(prompt, /docs\/features\//);
  assert.match(prompt, /Write ONLY the spec file path given in the user message/);
  assert.match(
    prompt,
    /Do not use Bash, subagents, or the web\. A later, separate implementer has shell access/,
  );
  assert.match(prompt, /ask_discord_users ONCE/);
  assert.match(prompt, /array of every independent question/);
  assert.match(prompt, /Never one question per tool call/);
  assert.match(prompt, /at most 2 rounds, 5 questions total; if a detail stays unanswered use the stated default/);
  assert.match(prompt, /Do not end with PLAN_BLOCKED because a detail was unanswered/);
  assert.match(prompt, /PLAN_COMPLETE or PLAN_BLOCKED/);
  assert.match(prompt, /Do not draft the entire SPEC in thinking/);
  assert.match(prompt, /The user is not watching in real time/);
  assert.match(prompt, /GAME_MAP of the last merged tree/);
  assert.match(prompt, /GAME_DECISIONS/);
  assert.match(prompt, /treat filled headings/);
  assert.doesNotMatch(prompt, /about 64000 tokens/);
  assert.ok(prompt.includes(RUNNER_CAPABILITIES_PROMPT));
  assert.ok(prompt.includes(SPEC_SHEET_TEMPLATE));
  assert.match(prompt, /The Verification hooks section/);
  assert.match(prompt, /window\.__egon\.state\(\)/);
  assert.match(prompt, /The Test scenarios section/);
  assert.match(prompt, /There is no agent in the loop/);
  assert.doesNotMatch(prompt, /decidable from a still screenshot of durable on-screen state/);
  assert.doesNotMatch(prompt, /Feature name:/);
});

test("claude planner user prompt is the shared user prompt", () => {
  const feature = { name: "Dash" } as Feature;
  const notes = ["make it snappy"];
  assert.equal(
    claudePlannerUserPrompt(feature, notes, "/data/attachments", []),
    plannerUserPrompt(feature, notes, "/data/attachments", []),
  );
});

test("claude planner user prompt is static-first then feature-specific", () => {
  const prompt = claudePlannerUserPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
    "# Game decisions\n\n## Art style\n\npixel\n",
  );
  const mapAt = prompt.indexOf("Viewport: 99x99");
  const decisionsAt = prompt.indexOf("## Art style");
  const nameAt = prompt.indexOf("Feature name: Dash");
  const specAt = prompt.indexOf("docs/features/dash/SPEC.md");
  const notesAt = prompt.indexOf("make it snappy");
  assert.doesNotMatch(prompt, /Spec sheet template:/);
  assert.ok(!prompt.includes(SPEC_SHEET_TEMPLATE));
  assert.ok(mapAt >= 0);
  assert.ok(mapAt < decisionsAt);
  assert.ok(decisionsAt < nameAt);
  assert.ok(nameAt < specAt);
  assert.ok(specAt < notesAt);
  assert.match(prompt, /Do not re-ask Discord/);
  assert.doesNotMatch(prompt, /about 64000 tokens/);
});

test("claude planner user prompts share a static prefix across features", () => {
  const gameMap = "# Game map\n\n- Viewport: 99x99\n";
  const decisions = "# Game decisions\n\n## Art style\n\npixel\n";
  const dash = claudePlannerUserPrompt({ name: "Dash" } as Feature, ["a"], "/data/a", [], gameMap, decisions);
  const jump = claudePlannerUserPrompt({ name: "Jump" } as Feature, ["b"], "/data/b", [], gameMap, decisions);
  const prefixEnd = dash.indexOf("Feature name:");
  assert.ok(prefixEnd > 0);
  assert.equal(dash.slice(0, prefixEnd), jump.slice(0, prefixEnd));
  assert.ok(!dash.slice(0, prefixEnd).includes(SPEC_SHEET_TEMPLATE));
  assert.ok(dash.slice(0, prefixEnd).includes("Viewport: 99x99"));
  assert.ok(dash.slice(0, prefixEnd).includes("## Art style"));
  assert.doesNotMatch(dash, /Keys: \{KeyW \/ none\}/);
});
