import assert from "node:assert/strict";
import { test } from "node:test";
import { plannerCanUseTool, plannerSpecPath } from "./permissions.js";

test("plannerCanUseTool allows reads and Discord Q&A", () => {
  const spec = plannerSpecPath("dash");
  assert.deepEqual(plannerCanUseTool(spec, "Read", { file_path: "src/main.gd" }), { behavior: "allow" });
  assert.deepEqual(plannerCanUseTool(spec, "Glob", { pattern: "**/*.gd" }), { behavior: "allow" });
  assert.deepEqual(plannerCanUseTool(spec, "Grep", { pattern: "HUD" }), { behavior: "allow" });
  assert.deepEqual(
    plannerCanUseTool(spec, "mcp__egon__ask_discord_users", { questions: [] }),
    { behavior: "allow" },
  );
});

test("plannerCanUseTool allows Write/Edit only on the spec path", () => {
  const spec = plannerSpecPath("dash");
  assert.deepEqual(plannerCanUseTool(spec, "Write", { file_path: spec }), { behavior: "allow" });
  assert.deepEqual(
    plannerCanUseTool(spec, "Edit", { file_path: `/game/${spec}` }),
    { behavior: "allow" },
  );
  const denied = plannerCanUseTool(spec, "Write", { file_path: "src/player.gd" });
  assert.equal(denied.behavior, "deny");
  const bash = plannerCanUseTool(spec, "Bash", { command: "ls" });
  assert.equal(bash.behavior, "deny");
});
