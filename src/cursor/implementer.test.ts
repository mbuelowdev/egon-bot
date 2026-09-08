import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import type { AssetMeta } from "../assets/store.js";
import { GODOT_CLI_GUIDE } from "./godotCli.js";
import { GODOT_WEB_GOTCHAS_PROMPT } from "./godotWebGotchas.js";
import { buildImplementerSendMessage, freshFixSeedAppendix, implementerPrompt } from "./implementer.js";
import { IMPLEMENTER_SUMMARY_PROMPT } from "./implementerSummary.js";
import { parseAcceptanceCriteria } from "./testReport.js";

test("implementer prompt includes the short Godot CLI cheat sheet", () => {
  const prompt = implementerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Verify edits with the Godot CLI before finishing/);
  assert.match(prompt, /Never --test, --editor\/-e, or --debug unattended/);
  assert.match(prompt, /Always rg -n --max-count 20; never cat a Godot log/);
  assert.match(prompt, /Do not Web-export/);
  assert.ok(prompt.includes(GODOT_CLI_GUIDE));
  assert.ok(prompt.includes(GODOT_WEB_GOTCHAS_PROMPT));
  assert.match(prompt, /godot --headless --path \. --import/);
  assert.match(prompt, /--check-only/);
  assert.match(prompt, /get_node\("\/root\/EgonBridge"\)\.register_field/);
  assert.match(prompt, /does not load autoloads/);
  assert.match(prompt, /--quit-after 60/);
  assert.match(prompt, /docs\/godot-cli\.md/);
  assert.doesNotMatch(prompt, /xargs/);
  assert.doesNotMatch(prompt, /--verbose/);
  assert.doesNotMatch(prompt, /--export-release Web/);
  assert.match(prompt, /Honor Scope, Out of scope, Assets, Implementation notes, Verification hooks/);
  assert.match(
    prompt,
    /Modify only the files the SPEC's Relevant files section lists, plus files you create; anything else must be justified under Deviations/,
  );
  assert.match(prompt, /window\.__egon\.state\(\)/);
  assert.doesNotMatch(prompt, /deployment\.json/);
});

test("implementer prompt injects the game map", () => {
  const prompt = implementerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
  );
  assert.match(prompt, /Prefer this over Glob\/Grep\/Read/);
  assert.match(prompt, /Viewport: 99x99/);
});

test("implementer prompt is static-first then feature-specific", () => {
  const prompt = implementerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "# Game map\n\n- Viewport: 99x99\n",
  );
  const guideAt = prompt.indexOf(GODOT_CLI_GUIDE);
  const gotchasAt = prompt.indexOf(GODOT_WEB_GOTCHAS_PROMPT);
  const mapAt = prompt.indexOf("Viewport: 99x99");
  const nameAt = prompt.indexOf("Feature name: Dash");
  const specAt = prompt.indexOf("docs/features/dash/SPEC.md");
  const notesAt = prompt.indexOf("make it snappy");
  assert.ok(guideAt >= 0);
  assert.ok(gotchasAt > guideAt);
  assert.ok(gotchasAt < mapAt);
  assert.ok(mapAt < nameAt);
  assert.ok(nameAt < specAt);
  assert.ok(specAt < notesAt);
});

test("implementer prompts share a static prefix across features", () => {
  const gameMap = "# Game map\n\n- Viewport: 99x99\n";
  const dash = implementerPrompt({ name: "Dash" } as Feature, ["a"], "/data/a", [], gameMap);
  const jump = implementerPrompt({ name: "Jump" } as Feature, ["b"], "/data/b", [], gameMap);
  const prefixEnd = dash.indexOf("Feature name:");
  assert.ok(prefixEnd > 0);
  assert.equal(dash.slice(0, prefixEnd), jump.slice(0, prefixEnd));
  assert.ok(dash.slice(0, prefixEnd).includes(GODOT_CLI_GUIDE));
  assert.ok(dash.slice(0, prefixEnd).includes(GODOT_WEB_GOTCHAS_PROMPT));
  assert.ok(dash.slice(0, prefixEnd).includes("Viewport: 99x99"));
  assert.match(
    dash.slice(0, prefixEnd),
    /Modify only the files the SPEC's Relevant files section lists, plus files you create/,
  );
  assert.ok(dash.slice(0, prefixEnd).includes("Files changed:"));
  assert.ok(dash.slice(0, prefixEnd).includes("Criteria self-verified:"));
  assert.ok(dash.slice(0, prefixEnd).includes("Deviations:"));
});

test("implementer prompt injects parsed acceptance criteria", () => {
  const spec = [
    "## 7. Acceptance criteria",
    "1. Keys: Space. JS: `() => window.__egon.state().playerX`. Then: return increases by 80.",
    "2. Keys: none. JS: `() => window.__egon.state().score`. Then: return is 1.",
    "",
    "## 8. Explicitly NOT this task",
    "- None.",
  ].join("\n");
  const criteria = parseAcceptanceCriteria(spec);
  const prompt = implementerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "",
    criteria,
  );
  assert.match(prompt, /Self-check Acceptance criteria/);
  assert.match(prompt, /Acceptance criteria:\n1\. Keys: Space\./);
  assert.match(prompt, /2\. Keys: none\. JS: `\(\) => window\.__egon\.state\(\)\.score`/);
  const specAt = prompt.indexOf("docs/features/dash/SPEC.md");
  const criteriaAt = prompt.indexOf("Acceptance criteria:");
  const notesAt = prompt.indexOf("make it snappy");
  assert.ok(specAt < criteriaAt);
  assert.ok(criteriaAt < notesAt);
});

test("implementer prompt omits an acceptance-criteria list when none were parsed", () => {
  const prompt = implementerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.match(prompt, /Self-check Acceptance criteria/);
  assert.doesNotMatch(prompt, /^Acceptance criteria:$/m);
});

test("implementer prompt requires a structured final message", () => {
  const prompt = implementerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.ok(prompt.includes(IMPLEMENTER_SUMMARY_PROMPT));
  const summaryAt = prompt.indexOf("Files changed:");
  const nameAt = prompt.indexOf("Feature name: Dash");
  assert.ok(summaryAt >= 0);
  assert.ok(summaryAt < nameAt);
});

test("implementer follow-up reminds the agent to end with the structured summary", () => {
  const followUp = buildImplementerSendMessage({
    feature: { name: "Dash", id: 1 } as Feature,
    notes: [],
    attachments: [],
    dataDir: "/data",
    followUp: "The tester found failures. Fix only [FAIL] items. Do not commit or push.",
  });
  assert.equal(typeof followUp, "string");
  assert.match(String(followUp), /Fix only \[FAIL\] items/);
  assert.match(String(followUp), /Files changed \/ Criteria self-verified \/ Deviations/);
  const again = buildImplementerSendMessage({
    feature: { name: "Dash", id: 1 } as Feature,
    notes: [],
    attachments: [],
    dataDir: "/data",
    followUp: `${String(followUp)}`,
  });
  assert.equal(again, followUp);
});

test("fresh fix seed inlines SPEC, diff, and the tester report on a full first send", () => {
  const spec = [
    "## 7. Acceptance criteria",
    "1. Keys: Space. JS: `() => window.__egon.state().playerX`. Then: return increases by 80.",
    "",
    "## 8. Explicitly NOT this task",
    "- None.",
  ].join("\n");
  const criteria = parseAcceptanceCriteria(spec);
  const message = buildImplementerSendMessage({
    feature: { name: "Dash", id: 1 } as Feature,
    notes: ["make it snappy"],
    attachments: [],
    dataDir: "/data",
    followUp: "The tester found failures. Fix only [FAIL] items. Do not commit or push.\n\n1. [FAIL] dash distance",
    fresh: true,
    spec,
    gitDiff: "diff --git a/player.gd b/player.gd\n+dash_speed = 80",
    criteria,
    gameMap: "# Game map\n\n- Viewport: 99x99\n",
  });
  const text = String(message);
  assert.match(text, /You are the Egon implementer/);
  assert.match(text, /There is no prior conversation/);
  assert.match(text, /SPEC:\n## 7\. Acceptance criteria/);
  assert.match(text, /Acceptance criteria:\n1\. Keys: Space\./);
  assert.match(text, /Git diff vs the default branch:\ndiff --git a\/player\.gd/);
  assert.match(text, /Fix only \[FAIL\] items/);
  assert.match(text, /1\. \[FAIL\] dash distance/);
  assert.doesNotMatch(text, /Files changed \/ Criteria self-verified \/ Deviations/);
  const prefixEnd = text.indexOf("Feature name:");
  assert.ok(prefixEnd > 0);
  assert.ok(text.slice(0, prefixEnd).includes("Viewport: 99x99"));
  assert.ok(text.indexOf("make it snappy") < text.indexOf("There is no prior conversation"));
});

test("freshFixSeedAppendix omits an empty SPEC and placeholders an empty diff", () => {
  const appendix = freshFixSeedAppendix("", "", "1. [FAIL] jump");
  assert.doesNotMatch(appendix, /^SPEC:/m);
  assert.match(appendix, /Git diff vs the default branch:\n\(no changes vs default branch\)/);
  assert.match(appendix, /1\. \[FAIL\] jump/);
});


const TRUCK: AssetMeta = {
  id: "garbage-truck-orange.glb",
  originalFilename: "a3f9c2d1.glb",
  sha256: "sha",
  bytes: 481203,
  kind: "model",
  format: "glTF 2.0 binary",
  fileOutput: "glTF binary model, version 2",
  measured: { bboxMeters: [2.1, 1.9, 5.4], triangles: 1240, animations: ["wheels_spin"] },
  description: "Orange municipal garbage truck",
  tags: [],
  grid: null,
  parts: [],
  uploadedAt: "2026-09-08T12:00:00.000Z",
};

const GRASS: AssetMeta = {
  ...TRUCK,
  id: "grass-plain.png",
  kind: "image",
  format: "PNG",
  measured: { width: 32, height: 32, colorType: "RGBA" },
  description: "Top-down seamless grass tile",
};

test("implementer prompt carries only the assets its spec declared, with measurements", () => {
  const prompt = implementerPrompt(
    { name: "Dash" } as Feature,
    ["make it snappy"],
    "/data/attachments",
    [],
    "",
    [],
    { ids: ["garbage-truck-orange.glb"], assets: [TRUCK, GRASS] },
  );
  assert.match(prompt, /`garbage-truck-orange\.glb` \| 2\.1 × 1\.9 × 5\.4 m, 1\.2k tris, anims: wheels_spin/);
  assert.match(prompt, /`assets\/library\/model\/garbage-truck-orange\.glb`/);
  assert.match(prompt, /Import them from there/);
  // Handing it the catalog invites a res:// path to an asset promotion never copied in.
  assert.doesNotMatch(prompt, /grass-plain/);
});

test("a spec that declares no assets gets no asset section", () => {
  const prompt = implementerPrompt({ name: "Dash" } as Feature, [], "/data/attachments", []);
  assert.doesNotMatch(prompt, /assets\/library/);
  assert.doesNotMatch(prompt, /Assets this SPEC declares/);
});

test("reference images are never presented to the implementer as importable files", () => {
  const prompt = implementerPrompt(
    { name: "Dash" } as Feature,
    ["match this HUD"],
    "/data/attachments",
    [
      {
        id: 1,
        featureId: 1,
        filename: "hud.png",
        mimeType: "image/png",
        storedName: "1.png",
        createdAt: "2026-09-08T12:00:00.000Z",
      },
    ],
  );
  assert.match(prompt, /reference material only/);
  assert.match(prompt, /must not be imported, copied, or referenced by any `res:\/\/` path/);
  assert.doesNotMatch(prompt, /Import them into the Godot project from there/);
  assert.doesNotMatch(prompt, /assets\/egon/);
});
