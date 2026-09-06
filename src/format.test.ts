import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeDiscordMarkdown,
  formatDuration,
  formatNoteAdded,
  formatPlanStarted,
  formatPlanningStart,
  formatTokenCount,
  PHASE_EMOJI,
} from "./format.js";

test("formatTokenCount compacts thousands and millions", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1000), "1k");
  assert.equal(formatTokenCount(1500), "1.5k");
  assert.equal(formatTokenCount(12_400), "12k");
  assert.equal(formatTokenCount(1_200_000), "1.2M");
  assert.equal(formatTokenCount(12_000_000), "12M");
});

test("formatDuration compacts wall-clock", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(4000), "4s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(120_000), "2m");
  assert.equal(formatDuration(3_720_000), "1h 2m");
  assert.equal(formatDuration(90_000_000), "1d 1h");
});

test("escapeDiscordMarkdown keeps user markdown from applying", () => {
  assert.equal(escapeDiscordMarkdown("use **bold** and _italics_"), "use \\*\\*bold\\*\\* and \\_italics\\_");
  assert.equal(escapeDiscordMarkdown("code `x` spoil ||y||"), "code \\`x\\` spoil \\|\\|y\\|\\|");
});

test("formatPlanStarted prefixes the planning emoji", () => {
  assert.equal(
    formatPlanStarted("Dash *HUD*"),
    `${PHASE_EMOJI.planning} Started planning **Dash \\*HUD\\***. Progress will be posted in this channel.`,
  );
});

test("formatPlanningStart lists notes and escapes formatting chars", () => {
  const text = formatPlanningStart("Dash *HUD*", [
    "jump **higher**",
    "- already a bullet\nand a newline",
    "1. numbered",
  ]);
  assert.equal(
    text,
    [
      `${PHASE_EMOJI.planning} Planning **Dash \\*HUD\\***.`,
      "- jump \\*\\*higher\\*\\*",
      "- \\- already a bullet and a newline",
      "- 1\\. numbered",
    ].join("\n"),
  );
});

test("formatPlanningStart stays within Discord's message limit", () => {
  const text = formatPlanningStart("Dash", ["x".repeat(2500)]);
  assert.ok(text.length <= 2000);
  assert.equal(text.endsWith("…"), true);
});

test("formatNoteAdded includes the note text", () => {
  assert.equal(
    formatNoteAdded("Jump", "jump has to be higher"),
    "Added a note to **Jump**.\n*jump has to be higher*",
  );
});

test("formatNoteAdded includes the asset path when an image was added", () => {
  assert.equal(
    formatNoteAdded("Jump", "use this HUD", "assets/egon/jump/hud.png"),
    "Added a note to **Jump**.\n*use this HUD*\nassets/egon/jump/hud.png",
  );
});

test("formatNoteAdded escapes player text", () => {
  assert.equal(
    formatNoteAdded("Dash *HUD*", "make it **bigger**"),
    "Added a note to **Dash \\*HUD\\***.\n*make it \\*\\*bigger\\*\\**",
  );
});
