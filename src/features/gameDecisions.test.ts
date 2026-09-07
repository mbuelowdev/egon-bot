import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  GAME_DECISIONS_REPO_PATH,
  accumulateGameDecisions,
  classifyDecisionTopic,
  gameDecisionsPromptSection,
  loadGameDecisionsMarkdown,
  mergeGameDecisions,
  parseGameDecisionTopic,
  parseGameDecisions,
  unwrapPlannerAnswer,
} from "./gameDecisions.js";

test("parseGameDecisionTopic accepts canonical ids and headings", () => {
  assert.equal(parseGameDecisionTopic("art-style"), "art-style");
  assert.equal(parseGameDecisionTopic("Art style"), "art-style");
  assert.equal(parseGameDecisionTopic("control_scheme"), "control-scheme");
  assert.equal(parseGameDecisionTopic("palette"), "palette");
  assert.equal(parseGameDecisionTopic("jump-height"), undefined);
});

test("classifyDecisionTopic prefers explicit topic then question keywords", () => {
  assert.equal(classifyDecisionTopic("What color is the HUD?", "palette"), "palette");
  assert.equal(classifyDecisionTopic("What art style should the game use?"), "art-style");
  assert.equal(classifyDecisionTopic("Top-down or side-scroller?"), "camera");
  assert.equal(classifyDecisionTopic("What is the control scheme?"), "control-scheme");
  assert.equal(classifyDecisionTopic("Which palette should we lock?"), "palette");
  assert.equal(classifyDecisionTopic("How high should the jump be?"), undefined);
  assert.equal(classifyDecisionTopic("What color is this enemy?"), undefined);
});

test("unwrapPlannerAnswer strips the unanswered-default wrapper", () => {
  assert.equal(unwrapPlannerAnswer("Pixel art"), "Pixel art");
  assert.equal(unwrapPlannerAnswer("(no Discord answer; using default: Pixel art)"), "Pixel art");
  assert.equal(unwrapPlannerAnswer("(no Discord answer; no default was provided)"), "");
});

test("mergeGameDecisions fills headings and last write wins", () => {
  const first = mergeGameDecisions("", [
    { topic: "art-style", answer: "pixel art" },
    { topic: "camera", answer: "side-scroller" },
  ]);
  assert.match(first, /## Art style\n\npixel art/);
  assert.match(first, /## Camera\n\nside-scroller/);
  assert.doesNotMatch(first, /## Palette/);
  const second = mergeGameDecisions(first, [{ topic: "art-style", answer: "hand-painted" }]);
  assert.match(second, /## Art style\n\nhand-painted/);
  assert.match(second, /## Camera\n\nside-scroller/);
});

test("parseGameDecisions keeps extra headings", () => {
  const parsed = parseGameDecisions(
    ["# Game decisions", "", "## Art style", "", "pixel", "", "## Audio", "", "chiptune", ""].join("\n"),
  );
  assert.equal(parsed.topics["art-style"], "pixel");
  assert.deepEqual(parsed.extra, [{ heading: "Audio", body: "chiptune" }]);
});

test("gameDecisionsPromptSection tells the planner not to re-ask settled choices", () => {
  assert.match(
    gameDecisionsPromptSection("").join("\n"),
    /No settled GAME_DECISIONS yet/,
  );
  const filled = gameDecisionsPromptSection("# Game decisions\n\n## Art style\n\npixel\n").join("\n");
  assert.match(filled, /Do not re-ask Discord/);
  assert.match(filled, /## Art style/);
});

test("accumulateGameDecisions writes docs/GAME_DECISIONS.md from global Q&A", () => {
  const gameRepoDir = mkdtempSync(join(tmpdir(), "egon-decisions-"));
  mkdirSync(join(gameRepoDir, "docs"), { recursive: true });
  assert.equal(
    accumulateGameDecisions({ gameRepoDir }, [
      { question: "Jump height?", answer: "64px" },
      { question: "Art style?", answer: "pixel art, 16x16", topic: "art-style" },
      { question: "Camera?", answer: "(no Discord answer; using default: side-scroller)" },
    ]),
    true,
  );
  const path = join(gameRepoDir, GAME_DECISIONS_REPO_PATH);
  const written = readFileSync(path, "utf8");
  assert.match(written, /## Art style\n\npixel art, 16x16/);
  assert.match(written, /## Camera\n\nside-scroller/);
  assert.doesNotMatch(written, /64px/);
  assert.equal(loadGameDecisionsMarkdown({ gameRepoDir }), written);
  assert.equal(
    accumulateGameDecisions({ gameRepoDir }, [
      { question: "Palette?", answer: "NES-like", topic: "palette" },
    ]),
    true,
  );
  const updated = readFileSync(path, "utf8");
  assert.match(updated, /## Art style\n\npixel art, 16x16/);
  assert.match(updated, /## Palette\n\nNES-like/);
});

test("accumulateGameDecisions no-ops when nothing is global", () => {
  const gameRepoDir = mkdtempSync(join(tmpdir(), "egon-decisions-none-"));
  assert.equal(
    accumulateGameDecisions({ gameRepoDir }, [{ question: "Jump height?", answer: "64px" }]),
    false,
  );
  assert.equal(loadGameDecisionsMarkdown({ gameRepoDir }), "");
});
