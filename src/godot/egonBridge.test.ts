import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  EGON_BRIDGE_AUTOLOAD,
  EGON_BRIDGE_AUTOLOAD_VALUE,
  EGON_BRIDGE_REPO_PATH,
  ensureEgonBridge,
  loadEgonBridgeScript,
  upsertAutoload,
} from "./egonBridge.js";

const ENTRY = `${EGON_BRIDGE_AUTOLOAD}="${EGON_BRIDGE_AUTOLOAD_VALUE}"`;

function repo(project?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "egon-bridge-"));
  if (project !== undefined) {
    writeFileSync(join(dir, "project.godot"), project, "utf8");
  }
  return dir;
}

test("the shipped autoload guards web-only code and never depends on callback returns", () => {
  const script = loadEgonBridgeScript();
  assert.match(script, /OS\.has_feature\("web"\)/);
  assert.match(script, /func register_field\(name: String, provider: Callable\) -> void:/);
  assert.match(script, /func snapshot\(\) -> Dictionary:/);
  assert.match(script, /JavaScriptBridge\.eval/);
  // create_callback return values are not dependable across Godot 4 point releases, so no
  // executable line may use it. The header comment explains that choice, hence stripping comments.
  const code = script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(code, /create_callback/);
  assert.match(code, /JavaScriptBridge\.eval/);
  // Pause-menu criteria must stay readable while the tree is paused.
  assert.match(script, /PROCESS_MODE_ALWAYS/);
});

test("upsertAutoload appends a section when project.godot has none", () => {
  const next = upsertAutoload('config_version=5\n\n[application]\n\nconfig/name="Game"\n', EGON_BRIDGE_AUTOLOAD, EGON_BRIDGE_AUTOLOAD_VALUE);
  assert.match(next, /\[autoload\]\n\n.*EgonBridge="\*res:\/\/egon\/egon_bridge\.gd"/s);
  assert.match(next, /config\/name="Game"/);
});

test("upsertAutoload adds the entry to an existing section without disturbing siblings", () => {
  const project = [
    "config_version=5",
    "",
    "[autoload]",
    "",
    'Music="*res://audio/music.gd"',
    'Save="*res://save.gd"',
    "",
    "[rendering]",
    "",
    'renderer/rendering_method="gl_compatibility"',
    "",
  ].join("\n");
  const next = upsertAutoload(project, EGON_BRIDGE_AUTOLOAD, EGON_BRIDGE_AUTOLOAD_VALUE);
  const lines = next.split("\n");
  assert.equal(lines.indexOf(ENTRY), lines.indexOf('Save="*res://save.gd"') + 1);
  assert.ok(lines.indexOf(ENTRY) < lines.indexOf("[rendering]"));
  assert.match(next, /renderer\/rendering_method="gl_compatibility"/);
});

test("upsertAutoload is a no-op when the entry is already correct", () => {
  const project = `config_version=5\n\n[autoload]\n\n${ENTRY}\n`;
  assert.equal(upsertAutoload(project, EGON_BRIDGE_AUTOLOAD, EGON_BRIDGE_AUTOLOAD_VALUE), project);
});

test("upsertAutoload repairs an entry pointing somewhere else", () => {
  const project = `config_version=5\n\n[autoload]\n\nEgonBridge="*res://old/path.gd"\n`;
  const next = upsertAutoload(project, EGON_BRIDGE_AUTOLOAD, EGON_BRIDGE_AUTOLOAD_VALUE);
  assert.match(next, /EgonBridge="\*res:\/\/egon\/egon_bridge\.gd"/);
  assert.doesNotMatch(next, /old\/path\.gd/);
  assert.equal(next.split("\n").filter((line) => line.startsWith("EgonBridge=")).length, 1);
});

test("ensureEgonBridge installs the script and registers the autoload", () => {
  const dir = repo('config_version=5\n\n[application]\n\nconfig/name="Game"\n');
  ensureEgonBridge(dir);
  assert.equal(readFileSync(join(dir, EGON_BRIDGE_REPO_PATH), "utf8"), loadEgonBridgeScript());
  assert.match(readFileSync(join(dir, "project.godot"), "utf8"), /EgonBridge="\*res:\/\/egon\/egon_bridge\.gd"/);
});

test("ensureEgonBridge reclaims a script a feature forked", () => {
  const dir = repo(`config_version=5\n\n[autoload]\n\n${ENTRY}\n`);
  mkdirSync(join(dir, "egon"), { recursive: true });
  writeFileSync(join(dir, EGON_BRIDGE_REPO_PATH), "extends Node\n# hand-edited\n", "utf8");
  ensureEgonBridge(dir);
  // Cumulative state only works if every feature shares one unmodified bridge.
  assert.equal(readFileSync(join(dir, EGON_BRIDGE_REPO_PATH), "utf8"), loadEgonBridgeScript());
});

test("ensureEgonBridge is idempotent across runs", () => {
  const dir = repo('config_version=5\n\n[autoload]\n\nMusic="*res://audio/music.gd"\n');
  ensureEgonBridge(dir);
  const first = readFileSync(join(dir, "project.godot"), "utf8");
  ensureEgonBridge(dir);
  ensureEgonBridge(dir);
  assert.equal(readFileSync(join(dir, "project.godot"), "utf8"), first);
  assert.equal(first.split("\n").filter((line) => line.startsWith("EgonBridge=")).length, 1);
});

test("ensureEgonBridge still writes the script when project.godot is missing", () => {
  const dir = repo();
  ensureEgonBridge(dir);
  assert.equal(readFileSync(join(dir, EGON_BRIDGE_REPO_PATH), "utf8"), loadEgonBridgeScript());
});

test("the bridge registers scenarios and reads both front doors at startup", () => {
  const script = loadEgonBridgeScript();
  // Two triggers, one code path: the browser query string and the headless cmdline.
  assert.match(script, /egon_scenario/);
  assert.match(script, /OS\.get_cmdline_user_args\(\)/);
  assert.match(script, /--egon-scenario=/);
  assert.match(script, /func register_scenario\(/);
  assert.match(script, /func registered_scenarios\(/);
  assert.match(script, /window\.__egon\.scenario = function/);
  assert.match(script, /window\.__egon\.scenarios = function/);
});

test("scenarios only run in debug builds", () => {
  // Without this gate anyone could jump straight to an ending on the public URL.
  const script = loadEgonBridgeScript();
  assert.match(script, /OS\.is_debug_build\(\)/);
});

test("an unknown scenario is a hard failure, never a silent normal boot", () => {
  const script = loadEgonBridgeScript();
  assert.match(script, /EGON_SCENARIO_UNKNOWN/);
  assert.match(script, /push_error\(/);
  assert.match(script, /EGON_SCENARIO_ACTIVE/);
});

test("the scenario is applied on the first frame, not in _ready", () => {
  // Autoloads run before the main scene, so anything registering from a gameplay
  // node's _ready() does not exist yet when the autoload is readied.
  const script = loadEgonBridgeScript();
  assert.match(script, /_scenario_resolved/);
  assert.match(script, /func _process\(/);
  const process = script.slice(script.indexOf("func _process("));
  assert.match(process, /_apply_requested_scenario\(\)/);
});

test("scenario scripts are discovered by file name from their own directory", () => {
  const script = loadEgonBridgeScript();
  assert.match(script, /res:\/\/egon\/scenarios/);
  assert.match(script, /\.remap/);
  assert.match(script, /has_method\("apply"\)/);
});
