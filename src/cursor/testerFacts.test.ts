import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateGameMap } from "../godot/gameMap.js";
import {
  MAX_TESTER_HUD_FACTS,
  parseTesterFactsFromGameMap,
  testerFactsPromptSection,
} from "./testerFacts.js";

const MAP = [
  "# Game map",
  "",
  "## Project",
  "",
  "- Viewport: 1280x720",
  "- Autoload: Hud → res://hud.tscn",
  "",
  "## Input",
  "",
  "| Action | Bindings |",
  "| --- | --- |",
  "| move_left | A |",
  "| fire | Mouse Left |",
  "",
  "## Features",
  "",
  "- `dash` — a dash",
  "",
  "## Scenes",
  "",
  "### main.tscn",
  "- Main (Node2D)",
  "  - Player (CharacterBody2D) → res://player.gd",
  "    - Sprite (Sprite2D)",
  "  - HUD (Instance)",
  "",
  "### hud.tscn",
  "- Hud (CanvasLayer)",
  "  - Score (Label)",
  "  - HealthBar (ProgressBar)",
  "  - Fire (Button)",
  "",
  "## Scripts",
  "",
  "### player.gd",
  "class_name Player",
  "",
].join("\n");

test("parseTesterFactsFromGameMap extracts canvas, controls, and HUD from GAME_MAP.md", () => {
  const facts = parseTesterFactsFromGameMap(MAP);
  assert.equal(facts.viewport, "1280x720");
  assert.deepEqual(facts.controls, [
    { action: "move_left", bindings: "A" },
    { action: "fire", bindings: "Mouse Left" },
  ]);
  assert.deepEqual(facts.hud, [
    { scene: "main.tscn", node: "HUD", type: "Instance" },
    { scene: "hud.tscn", node: "Hud", type: "CanvasLayer" },
    { scene: "hud.tscn", node: "Score", type: "Label" },
    { scene: "hud.tscn", node: "HealthBar", type: "ProgressBar" },
    { scene: "hud.tscn", node: "Fire", type: "Button" },
  ]);
});

test("parseTesterFactsFromGameMap skips sprites and empty input", () => {
  const facts = parseTesterFactsFromGameMap(
    ["## Input", "", "(none)", "", "## Scenes", "", "### world.tscn", "- Tree (Sprite2D)", "- Coin (Area2D)"].join(
      "\n",
    ),
  );
  assert.equal(facts.viewport, "");
  assert.deepEqual(facts.controls, []);
  assert.deepEqual(facts.hud, []);
});

test("testerFactsPromptSection is compact and names boot plus Playwright space", () => {
  const block = testerFactsPromptSection(MAP).join("\n");
  assert.match(block, /do not Read the SPEC/);
  assert.match(block, /Canvas: Godot 1280x720; Playwright 960x540 \(click coordinates are Playwright space\)/);
  assert.match(block, /Expected boot: up to 25s per evaluate, at most 2 calls/);
  assert.match(block, /Controls: move_left=A; fire=Mouse Left/);
  assert.match(block, /HUD: HUD \(Instance, main\.tscn\); Hud \(CanvasLayer, hud\.tscn\); Score \(Label, hud\.tscn\)/);
  assert.doesNotMatch(block, /class_name Player/);
  assert.doesNotMatch(block, /Sprite2D/);
});

test("testerFactsPromptSection still emits boot and Playwright size without a map", () => {
  const block = testerFactsPromptSection("").join("\n");
  assert.match(block, /Canvas: Playwright 960x540/);
  assert.match(block, /Expected boot: up to 25s/);
  assert.match(block, /Controls: \(none\)/);
  assert.match(block, /HUD: \(none\)/);
});

test("testerFactsPromptSection caps a long HUD list", () => {
  const nodes = Array.from({ length: MAX_TESTER_HUD_FACTS + 3 }, (_, i) => `  - L${String(i)} (Label)`);
  const block = testerFactsPromptSection(["## Scenes", "", "### ui.tscn", "- Root (Control)", ...nodes].join("\n")).join(
    "\n",
  );
  assert.match(block, /L0 \(Label, ui\.tscn\)/);
  assert.match(block, /; …/);
  assert.doesNotMatch(block, new RegExp(`L${String(MAX_TESTER_HUD_FACTS)} \\(Label`));
});

test("parseTesterFactsFromGameMap reads generateGameMap markdown", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-tester-facts-"));
  writeFileSync(
    join(root, "project.godot"),
    [
      "[display]",
      "window/size/viewport_width=1280",
      "window/size/viewport_height=720",
      "[input]",
      "fire={",
      '"events": [Object(InputEventKey,"physical_keycode":32,"script":null)]',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "main.tscn"),
    ["[node name=\"Main\" type=\"Node2D\"]", "[node name=\"HUD\" type=\"CanvasLayer\" parent=\".\"]"].join("\n"),
  );
  mkdirSync(join(root, "docs", "features"), { recursive: true });
  const facts = parseTesterFactsFromGameMap(generateGameMap(root));
  assert.equal(facts.viewport, "1280x720");
  assert.deepEqual(facts.controls, [{ action: "fire", bindings: "Space" }]);
  assert.deepEqual(facts.hud, [{ scene: "main.tscn", node: "HUD", type: "CanvasLayer" }]);
});
