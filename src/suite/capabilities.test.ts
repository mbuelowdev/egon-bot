import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature } from "../features/store.js";
import { EGON_STATE_TIMEOUT_MS } from "./statePoll.js";
import { plannerPrompt } from "../cursor/planner.js";
import {
  RUNNER_CAPABILITIES_PROMPT,
  TESTER_VIEWPORT_HEIGHT,
  TESTER_VIEWPORT_SIZE,
  TESTER_VIEWPORT_WIDTH,
} from "./capabilities.js";

test("runner capabilities describe a deterministic program, not an agent", () => {
  assert.match(RUNNER_CAPABILITIES_PROMPT, /There is no agent in the loop/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /cannot:[\s\S]*- Improvise/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, new RegExp(TESTER_VIEWPORT_SIZE));
  assert.equal(TESTER_VIEWPORT_SIZE, "960x540");
  // The MCP tester's vocabulary is gone; nothing should still describe those tools.
  assert.doesNotMatch(RUNNER_CAPABILITIES_PROMPT, /browser_press_key|browser_mouse_click_xy|browser_evaluate/);
  assert.doesNotMatch(RUNNER_CAPABILITIES_PROMPT, /caps=vision|snapshot-mode=none/);
  assert.doesNotMatch(RUNNER_CAPABILITIES_PROMPT, /Keys: \{|Click: \{|JS: \{/);
});

test("runner capabilities require every check to name a scenario", () => {
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Every check names a scenario/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Load any registered scenario by name/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /GAME_MAP Scenarios table/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /only declare a new one when none does/);
});

test("runner capabilities spell out that a key press is a tap, not a hold", () => {
  // A tap can land and release inside one frame, so a check built on
  // Input.is_action_pressed can fail a correct implementation.
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Each press is a tap/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /cannot:[\s\S]*- Hold a key down across frames/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Input\.is_action_pressed` polled in `_process` may observe it zero times/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Input-driven checks must survive a tap/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /`jumpCount`, `dashesStarted`, `shotsFired`/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /needs a held key is untestable/);
});

test("runner capabilities forbid sleeps outright", () => {
  assert.match(RUNNER_CAPABILITIES_PROMPT, /cannot:[\s\S]*- Sleep\. Waiting is always a condition/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Wait for a condition to become true/);
});

test("runner capabilities describe screenshot and video human proof", () => {
  assert.match(RUNNER_CAPABILITIES_PROMPT, /`proof` field/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /record_ms/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Inherited regression checks are screenshots/);
});

test("runner capabilities give a click conversion keyed on the GAME_MAP stretch mode", () => {
  // Under Godot's default stretch mode nothing is scaled, so a bare
  // viewport-ratio formula would place every click wrong.
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Converting a Godot position into click coordinates/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /depends on GAME_MAP's `Stretch:` line/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /`disabled` \(Godot's default\): nothing is scaled/);
  assert.match(
    RUNNER_CAPABILITIES_PROMPT,
    new RegExp(`a centered Control is at ${String(TESTER_VIEWPORT_WIDTH / 2)},${String(TESTER_VIEWPORT_HEIGHT / 2)}`),
  );
  assert.match(
    RUNNER_CAPABILITIES_PROMPT,
    new RegExp(`x = round\\(godotX × ${String(TESTER_VIEWPORT_WIDTH)} / W\\)`),
  );
  assert.match(RUNNER_CAPABILITIES_PROMPT, /letterboxed\. s = min\(/);
  // Every ${...} must have been interpolated, not shipped as literal source text.
  assert.doesNotMatch(RUNNER_CAPABILITIES_PROMPT, /\$\{/);
});

test("runner capabilities tell the planner the bridge is read with a settle-poll", () => {
  assert.match(RUNNER_CAPABILITIES_PROMPT, /Re-read after input with a settle-poll/);
  assert.match(RUNNER_CAPABILITIES_PROMPT, /not one that exists for only a few frames/);
  assert.ok(EGON_STATE_TIMEOUT_MS > 0);
});

test("cursor planner prompt injects the runner capability list before the feature text", () => {
  const prompt = plannerPrompt({ name: "Dash" } as Feature, ["make it snappy"], "/data/attachments", []);
  assert.ok(prompt.includes(RUNNER_CAPABILITIES_PROMPT));
  const capsAt = prompt.indexOf(RUNNER_CAPABILITIES_PROMPT);
  const nameAt = prompt.indexOf("Feature name: Dash");
  assert.ok(capsAt >= 0);
  assert.ok(capsAt < nameAt);
});
