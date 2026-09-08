import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import type { AssetMeta } from "../assets/store.js";
import { PLANNER_INSTRUCTIONS, plannerPrompt, plannerUserPrompt } from "./plannerPrompt.js";
import { SPEC_SHEET_TEMPLATE } from "./specTemplate.js";
import { RUNNER_CAPABILITIES_PROMPT } from "../suite/capabilities.js";

test("planner prompt is the shared instructions plus the user prompt", () => {
  const feature = { name: "Dash" } as Feature;
  const notes = ["make it snappy"];
  const user = plannerUserPrompt(feature, notes, "/data/attachments", []);
  const prompt = plannerPrompt(feature, notes, "/data/attachments", []);
  assert.equal(prompt, `${PLANNER_INSTRUCTIONS}\n\n${user}`);
  assert.doesNotMatch(prompt, /about 64000 tokens/);
  assert.match(prompt, /Do not use Bash, subagents, or the web/);
  assert.match(prompt, /Do not draft the entire SPEC in thinking/);
});

test("planner prompt requires a specific spec and clarifying questions", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Make the spec as specific as possible/);
  assert.match(
    prompt,
    /Do not use Bash, subagents, or the web\. A later, separate implementer has shell access; do not treat your own lack of web access as a game constraint/,
  );
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
  // Headings are asserted by name: the template is renumbered when a section is added.
  assert.match(prompt, /## \d+\. Context & Goal/);
  assert.match(prompt, /## \d+\. Scope/);
  assert.match(prompt, /## \d+\. Interface \/ Contract/);
  assert.match(prompt, /## \d+\. Verification hooks/);
  assert.match(prompt, /window\.__egon\.state\(\)/);
  assert.match(prompt, /## \d+\. Test scenarios/);
  assert.match(prompt, /## \d+\. Acceptance criteria/);
  assert.match(prompt, /## \d+\. Explicitly NOT this task/);
  assert.match(prompt, /The Verification hooks section/);
  assert.match(prompt, /The Test scenarios section/);
  assert.match(prompt, /The Acceptance criteria section/);
  assert.match(prompt, /The Explicitly NOT this task section/);
  // Section numbers must not be baked into the prompt at all.
  assert.doesNotMatch(prompt, /Section \d+ \(/);
  assert.match(prompt, /egon\/checks\//);
  // The retired grammar must be gone: steps live in the checks file now.
  assert.doesNotMatch(prompt, /Keys: \{KeyW/);
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
  assert.ok(dash.slice(0, prefixEnd).includes(RUNNER_CAPABILITIES_PROMPT));
  assert.ok(dash.slice(0, prefixEnd).includes("Viewport: 99x99"));
  assert.ok(dash.slice(0, prefixEnd).includes("## Art style"));
});

test("planner prompt injects the asset library index and never the measured facts", () => {
  const truck: AssetMeta = {
    id: "garbage-truck-orange.glb",
    originalFilename: "a3f9c2d1.glb",
    sha256: "sha",
    bytes: 481203,
    kind: "model",
    format: "glTF 2.0 binary",
    fileOutput: "glTF binary model, version 2",
    measured: { bboxMeters: [2.1, 1.9, 5.4], triangles: 1240 },
    description: "Orange municipal garbage truck, wheels are separate nodes",
    tags: ["vehicle"],
    grid: null,
    parts: [],
    uploadedAt: "2026-09-08T12:00:00.000Z",
  };
  const prompt = plannerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "",
    "",
    [truck],
  );
  assert.match(prompt, /Asset library index/);
  assert.match(prompt, /- `garbage-truck-orange\.glb` — Orange municipal garbage truck/);
  assert.match(prompt, /never invent a filename/);
  // The measured column is the implementer's slice; the planner only picks ids.
  assert.doesNotMatch(prompt, /2\.1 × 1\.9 × 5\.4/);
  assert.doesNotMatch(prompt, /1\.2k tris/);
});

test("planner prompt tells an empty library to write None.", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, [], "/data/attachments", []);
  assert.match(prompt, /the library is empty/);
  assert.match(prompt, /write `None\.`/);
});
