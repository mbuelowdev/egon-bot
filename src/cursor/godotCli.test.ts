import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ensureGodotCliGuide,
  GODOT_CLI_GUIDE,
  GODOT_CLI_GUIDE_REPO_PATH,
  loadGodotCliGuideMarkdown,
} from "./godotCli.js";

test("injected Godot CLI guide is a short subset of the on-disk reference", () => {
  const lines = GODOT_CLI_GUIDE.split("\n");
  assert.ok(lines.length >= 12 && lines.length <= 20, `got ${String(lines.length)} lines`);
  assert.match(GODOT_CLI_GUIDE, /-- --egon-scenario=NAME/);
  assert.match(GODOT_CLI_GUIDE, /EGON_SCENARIO_ACTIVE/);
  assert.match(GODOT_CLI_GUIDE, /godot --headless --path \. --import/);
  assert.match(GODOT_CLI_GUIDE, /--check-only/);
  assert.match(GODOT_CLI_GUIDE, /--quit-after 60/);
  assert.match(GODOT_CLI_GUIDE, /rg -n --max-count 20/);
  assert.match(GODOT_CLI_GUIDE, /Never `cat` a Godot log/);
  assert.match(GODOT_CLI_GUIDE, /docs\/godot-cli\.md/);
  assert.doesNotMatch(GODOT_CLI_GUIDE, /xargs/);
  assert.doesNotMatch(GODOT_CLI_GUIDE, /--verbose/);
  assert.doesNotMatch(GODOT_CLI_GUIDE, /--export-release/);
  assert.doesNotMatch(GODOT_CLI_GUIDE, /--export-debug/);
});

test("on-disk Godot CLI guide keeps the extra commands the prompt omits", () => {
  const full = loadGodotCliGuideMarkdown();
  assert.notEqual(GODOT_CLI_GUIDE, full);
  assert.match(full, /xargs/);
  assert.match(full, /--verbose/);
  assert.match(full, /rg -n --max-count 20/);
  assert.match(full, /Never `cat` a Godot log/);
  assert.match(full, /tens of thousands of lines/);
  assert.match(full, /--export-release Web/);
  assert.match(full, /--export-debug Web/);
});

test("ensureGodotCliGuide copies the full reference into the game repo", () => {
  const gameRepoDir = mkdtempSync(join(tmpdir(), "egon-godot-cli-"));
  ensureGodotCliGuide(gameRepoDir);
  const copied = readFileSync(join(gameRepoDir, GODOT_CLI_GUIDE_REPO_PATH), "utf8").trim();
  assert.equal(copied, loadGodotCliGuideMarkdown());
  assert.notEqual(copied, GODOT_CLI_GUIDE);
});
