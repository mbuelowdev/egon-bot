import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { plannerPrompt } from "./planner.js";
import { playwrightMcpServer } from "./playwrightMcp.js";
import { TESTER_CAPABILITIES_PROMPT, TESTER_VIEWPORT_SIZE } from "./testerCapabilities.js";

test("tester capabilities name keys, click, and JS, not screenshot-only prose", () => {
  assert.match(TESTER_CAPABILITIES_PROMPT, /--caps=vision/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /--snapshot-mode=none/);
  assert.match(TESTER_CAPABILITIES_PROMPT, new RegExp(`--viewport-size=${TESTER_VIEWPORT_SIZE}`));
  assert.match(TESTER_CAPABILITIES_PROMPT, /no devtools cap/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /Use accessibility snapshot refs/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /browser_press_key/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /browser_mouse_click_xy/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /browser_evaluate/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /browser_evaluate-poll the Godot shell `#status` overlay \/ canvas pixels/);
  assert.doesNotMatch(TESTER_CAPABILITIES_PROMPT, /wait until the canvas is visible/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /Click, move, or drag at viewport coordinates/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /not Godot's project viewport from GAME_MAP/);
  assert.doesNotMatch(TESTER_CAPABILITIES_PROMPT, /cannot:\n- Click, move, or drag at coordinates/m);
  assert.match(TESTER_CAPABILITIES_PROMPT, /not GDScript, the scene tree, or the remote inspector/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /browser_console_messages \(core, level: "error"\)/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /implicit criterion 0/);
  assert.doesNotMatch(TESTER_CAPABILITIES_PROMPT, /Never require "no console errors"/);
  assert.doesNotMatch(TESTER_CAPABILITIES_PROMPT, /reliable browser console errors/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /concrete interaction, not prose/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /Keys: \{exact browser_press_key names, or none\}/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /Click: \{browser_mouse_click_xy x,y, or none\}/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /JS: \{exact `\(\) => …`/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /window\.__egon\.state\(\)/);
  assert.match(TESTER_CAPABILITIES_PROMPT, /guessing from pixels/);
  assert.doesNotMatch(
    TESTER_CAPABILITIES_PROMPT,
    /decidable from a still screenshot of durable on-screen state/,
  );
});

test("playwright MCP is launched with vision cap and without extra caps", () => {
  const server = playwrightMcpServer({
    screenshotsDir: "/data/features/1/screenshots",
    executablePath: "/opt/chrome",
  });
  assert.ok("args" in server && server.args);
  assert.ok(server.args.includes("--caps=vision"));
  assert.ok(server.args.includes("--snapshot-mode=none"));
  assert.ok(server.args.includes(`--viewport-size=${TESTER_VIEWPORT_SIZE}`));
  assert.ok(!server.args.some((arg) => arg.includes("devtools")));
});

test("cursor planner prompt injects the tester capability list", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.ok(prompt.includes(TESTER_CAPABILITIES_PROMPT));
  const capsAt = prompt.indexOf(TESTER_CAPABILITIES_PROMPT);
  const nameAt = prompt.indexOf("Feature name: Dash");
  assert.ok(capsAt >= 0);
  assert.ok(capsAt < nameAt);
  assert.doesNotMatch(prompt, /decidable from a still screenshot of durable on-screen state/);
});
