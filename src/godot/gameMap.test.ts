import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  generateGameMap,
  gameMapPath,
  gameMapPromptSection,
  loadGameMapMarkdown,
  parseBridgeFields,
  parseGdSummary,
  parseTscnTree,
  specSection1Summary,
  writeGameMap,
  parseScenarioSummary,} from "./gameMap.js";

const PROJECT = `; Engine configuration file.
config_version=5

[application]

config/name="Arena"
config/features=PackedStringArray("4.4", "Forward Plus")
run/main_scene="res://main.tscn"

[autoload]

GameState="*res://game_state.gd"
Hud="res://hud.tscn"

[display]

window/size/viewport_width=1280
window/size/viewport_height=720

[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":65,"key_label":0,"unicode":97,"location":0,"echo":false,"script":null)
]
}
fire={
"deadzone": 0.5,
"events": [Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":1,"canceled":false,"pressed":false,"double_click":false,"script":null)
]
}

[layer_names]

2d_physics/layer_1="player"
2d_physics/layer_2="enemy"
3d_physics/layer_1="world"

[rendering]

renderer/rendering_method="forward_plus"
`;

const MAIN_TSCN = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://player.gd" id="1_player"]
[ext_resource type="PackedScene" path="res://hud.tscn" id="2_hud"]

[node name="Main" type="Node2D"]

[node name="Player" type="CharacterBody2D" parent="." groups=["player"]]
script = ExtResource("1_player")

[node name="Sprite" type="Sprite2D" parent="Player"]

[node name="HUD" parent="." instance=ExtResource("2_hud")]
`;

const PLAYER_GD = `class_name Player
extends CharacterBody2D

signal health_changed(new_health: int)
signal died

@export var speed: float = 200.0
@export_range(0, 100) var hp: int = 10

@export
var jump_velocity: float = -400.0

func _ready() -> void:
	pass

func take_damage(amount: int) -> void:
	hp -= amount

static func create() -> Player:
	return Player.new()
`;

const SPEC = `# Dash

## 1. Context & Goal

Give the player a short dash to cross gaps. This is the first movement upgrade.

## 2. Scope

### In scope

- Dash action
`;

function writeGameRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "egon-gamemap-"));
  writeFileSync(join(root, "project.godot"), PROJECT);
  writeFileSync(join(root, "main.tscn"), MAIN_TSCN);
  writeFileSync(join(root, "player.gd"), PLAYER_GD);
  mkdirSync(join(root, "docs", "features", "dash"), { recursive: true });
  writeFileSync(join(root, "docs", "features", "dash", "SPEC.md"), SPEC);
  mkdirSync(join(root, "addons", "third"), { recursive: true });
  writeFileSync(join(root, "addons", "third", "ignore_me.gd"), "extends Node\n");
  mkdirSync(join(root, ".godot"), { recursive: true });
  writeFileSync(join(root, ".godot", "hidden.gd"), "extends Node\n");
  return root;
}

test("generateGameMap reports an explicit stretch mode so click coordinates can be converted", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-gamemap-stretch-"));
  writeFileSync(
    join(root, "project.godot"),
    `[display]

window/size/viewport_width=640
window/size/viewport_height=360
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"
`,
  );
  const map = generateGameMap(root);
  assert.match(map, /Viewport: 640x360/);
  assert.match(map, /Stretch: canvas_items \(aspect expand\)/);
});

test("generateGameMap indexes project settings, scenes, scripts, and merged specs", () => {
  const root = writeGameRepo();
  const map = generateGameMap(root);
  assert.match(map, /Godot: 4\.4/);
  assert.match(map, /Renderer: forward_plus/);
  assert.match(map, /Main scene: res:\/\/main\.tscn/);
  assert.match(map, /Viewport: 1280x720/);
  // Absent from project.godot means Godot defaults, and those mean no scaling at all.
  assert.match(map, /Stretch: disabled \(aspect keep\)/);
  assert.match(map, /GameState → res:\/\/game_state\.gd \(singleton\)/);
  assert.match(map, /Hud → res:\/\/hud\.tscn/);
  assert.match(map, /Physics layers \(2D\): 1=player, 2=enemy/);
  assert.match(map, /Physics layers \(3D\): 1=world/);
  assert.match(map, /\| move_left \| A \|/);
  assert.match(map, /\| fire \| Mouse Left \|/);
  assert.match(map, /`dash` — Give the player a short dash to cross gaps\. This is the first movement upgrade\./);
  assert.match(map, /### main\.tscn/);
  assert.match(map, /- Main \(Node2D\)/);
  assert.match(map, /  - Player \(CharacterBody2D\) → res:\/\/player\.gd/);
  assert.match(map, /    - Sprite \(Sprite2D\)/);
  assert.match(map, /  - HUD \(Instance\)/);
  assert.match(map, /### player\.gd/);
  assert.match(map, /^class_name Player$/m);
  assert.match(map, /^extends CharacterBody2D$/m);
  assert.match(map, /^signal health_changed\(new_health: int\)$/m);
  assert.match(map, /^@export var speed: float = 200\.0$/m);
  assert.match(map, /^@export_range\(0, 100\) var hp: int = 10$/m);
  assert.match(map, /^@export var jump_velocity: float = -400\.0$/m);
  assert.match(map, /^func take_damage\(amount: int\) -> void$/m);
  assert.match(map, /^static func create\(\) -> Player$/m);
  assert.doesNotMatch(map, /func _ready/);
  assert.doesNotMatch(map, /ignore_me/);
  assert.doesNotMatch(map, /hidden\.gd/);
  assert.equal(generateGameMap(root), map);
});

test("generateGameMap is empty-safe when project.godot is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-gamemap-empty-"));
  const map = generateGameMap(root);
  assert.match(map, /No project\.godot found/);
  assert.match(map, /\(none\)/);
});

test("writeGameMap caches markdown under dataDir and load prefers the cache", () => {
  const root = writeGameRepo();
  const dataDir = mkdtempSync(join(tmpdir(), "egon-gamemap-data-"));
  const written = writeGameMap({ gameRepoDir: root, dataDir });
  assert.equal(readFileSync(gameMapPath(dataDir), "utf8"), `${written.endsWith("\n") ? written : `${written}\n`}`);
  writeFileSync(join(root, "player.gd"), "extends Node\n");
  assert.match(loadGameMapMarkdown({ gameRepoDir: root, dataDir }), /class_name Player/);
});

test("parseTscnTree indents the node tree and resolves scripts", () => {
  const lines = parseTscnTree(MAIN_TSCN);
  assert.deepEqual(lines, [
    "- Main (Node2D)",
    "  - Player (CharacterBody2D) → res://player.gd",
    "    - Sprite (Sprite2D)",
    "  - HUD (Instance)",
  ]);
});

test("parseGdSummary lists public surface one line each", () => {
  const items = parseGdSummary(PLAYER_GD);
  assert.deepEqual(items, [
    "class_name Player",
    "extends CharacterBody2D",
    "signal health_changed(new_health: int)",
    "signal died",
    "@export var speed: float = 200.0",
    "@export_range(0, 100) var hp: int = 10",
    "@export var jump_velocity: float = -400.0",
    "func take_damage(amount: int) -> void",
    "static func create() -> Player",
  ]);
});

test("specSection1Summary collapses the first paragraph", () => {
  assert.equal(
    specSection1Summary(SPEC),
    "Give the player a short dash to cross gaps. This is the first movement upgrade.",
  );
});

test("gameMapPromptSection is omitted when empty", () => {
  assert.deepEqual(gameMapPromptSection("  \n"), []);
  assert.match(gameMapPromptSection("# Game map\n").join("\n"), /Prefer this over Glob\/Grep\/Read/);
});

test("parseBridgeFields captures registered field names and their providers", () => {
  const fields = parseBridgeFields(
    [
      "extends CharacterBody2D",
      "",
      "func _ready() -> void:",
      '\tEgonBridge.register_field("playerX", func(): return global_position.x)',
      '\tEgonBridge.register_field("score", func(): return _score)',
      '\t# EgonBridge.register_field("commented", func(): return 1)',
      "",
    ].join("\n"),
  );
  assert.deepEqual(fields, [
    { name: "playerX", provider: "func(): return global_position.x" },
    { name: "score", provider: "func(): return _score" },
  ]);
});

test("generateGameMap compiles the bridge fields already exposed to the tester", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-map-bridge-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "project.godot"), 'config_version=5\n', "utf8");
  writeFileSync(
    join(dir, "scripts", "player.gd"),
    'extends Node\nfunc _ready():\n\tEgonBridge.register_field("playerX", func(): return global_position.x)\n',
    "utf8",
  );
  writeFileSync(
    join(dir, "scripts", "hud.gd"),
    'extends Control\nfunc _ready():\n\tEgonBridge.register_field("score", func(): return _score)\n',
    "utf8",
  );
  const map = generateGameMap(dir);
  assert.match(map, /## Debug bridge/);
  assert.match(map, /\| playerX \| `scripts\/player\.gd` \| `func\(\): return global_position\.x` \|/);
  assert.match(map, /\| score \| `scripts\/hud\.gd` \|/);
  assert.match(map, /Reuse a field that already answers your check/);
});

test("generateGameMap says so when nothing is registered yet", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-map-nobridge-"));
  writeFileSync(join(dir, "project.godot"), "config_version=5\n", "utf8");
  const map = generateGameMap(dir);
  assert.match(map, /## Debug bridge\n\n[\s\S]*\(none registered yet\)/);
});

test("generateGameMap ignores register_field inside the autoload that defines it", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-map-selfbridge-"));
  mkdirSync(join(dir, "egon"), { recursive: true });
  writeFileSync(join(dir, "project.godot"), "config_version=5\n", "utf8");
  writeFileSync(
    join(dir, "egon", "egon_bridge.gd"),
    'extends Node\nfunc register_field(name: String, provider: Callable) -> void:\n\t_providers[name] = provider\n',
    "utf8",
  );
  const map = generateGameMap(dir);
  assert.match(map, /\(none registered yet\)/);
});

test("parseBridgeFields keeps a provider that itself ends in a call", () => {
  assert.deepEqual(
    parseBridgeFields('\tEgonBridge.register_field("score", func(): return get_score())\n'),
    [{ name: "score", provider: "func(): return get_score()" }],
  );
  assert.deepEqual(
    parseBridgeFields('\tEgonBridge.register_field("alive", _is_alive)\n'),
    [{ name: "alive", provider: "_is_alive" }],
  );
});

test("the game map lists scenarios with their file and doc line", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-map-scenarios-"));
  mkdirSync(join(dir, "egon", "scenarios"), { recursive: true });
  writeFileSync(join(dir, "project.godot"), 'config_version=5\n');
  writeFileSync(
    join(dir, "egon", "scenarios", "endgame_victory.gd"),
    "## The victory screen after a full run.\nextends RefCounted\n\nfunc apply() -> void:\n\tpass\n",
  );
  writeFileSync(join(dir, "egon", "scenarios", "boss_room.gd"), "extends RefCounted\n");
  const map = generateGameMap(dir);
  assert.match(map, /## Scenarios/);
  assert.match(map, /\| boss_room \| `egon\/scenarios\/boss_room\.gd` \| \(undocumented\) \|/);
  assert.match(
    map,
    /\| endgame_victory \| `egon\/scenarios\/endgame_victory\.gd` \| The victory screen after a full run\. \|/,
  );
  assert.match(map, /`default` is always available/);
});

test("a game with no scenarios says so instead of showing an empty table", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-map-no-scenarios-"));
  writeFileSync(join(dir, "project.godot"), 'config_version=5\n');
  const map = generateGameMap(dir);
  assert.match(map, /## Scenarios/);
  assert.match(map, /\(none yet — every check runs against `default`\)/);
});

test("parseScenarioSummary reads the leading doc comment only", () => {
  assert.equal(parseScenarioSummary("## Victory screen.\nextends RefCounted\n"), "Victory screen.");
  assert.equal(parseScenarioSummary("extends RefCounted\n## Not a header.\n"), "(undocumented)");
  assert.equal(parseScenarioSummary(""), "(undocumented)");
});
