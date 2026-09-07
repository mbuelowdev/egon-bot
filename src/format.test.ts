import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeDiscordMarkdown,
  formatDeployFailure,
  formatDeploySuccess,
  formatDuration,
  formatFeatureName,
  formatImplementationStart,
  formatNoteAdded,
  formatPivoting,
  formatPlanStarted,
  formatPlannerFallback,
  formatPlanningStart,
  formatReviewReady,
  formatTesterPassOutcome,
  formatTestReport,
  formatTestingStart,
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
  assert.equal(
    formatPlanStarted("Dash HUD", "https://egon.example/features/dash-hud"),
    `${PHASE_EMOJI.planning} Started planning [**Dash HUD**](<https://egon.example/features/dash-hud>). Progress will be posted in this channel.`,
  );
});

test("formatPlannerFallback names the Cursor fallback", () => {
  assert.equal(
    formatPlannerFallback("Dash HUD"),
    `${PHASE_EMOJI.planning} Claude usage limit while planning **Dash HUD**. Falling back to the Cursor planner.`,
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
  assert.equal(
    formatPlanningStart("Dash HUD", [], "https://egon.example/features/dash-hud"),
    `${PHASE_EMOJI.planning} Planning [**Dash HUD**](<https://egon.example/features/dash-hud>).`,
  );
});

test("formatPlanningStart stays within Discord's message limit", () => {
  const text = formatPlanningStart("Dash", ["x".repeat(2500)]);
  assert.ok(text.length <= 2000);
  assert.equal(text.endsWith("…"), true);
});

test("formatFeatureName links the bold name when a catalog URL is given", () => {
  assert.equal(formatFeatureName("Dash *HUD*"), "**Dash \\*HUD\\***");
  assert.equal(
    formatFeatureName("Dash HUD", "https://egon.example/features/dash-hud"),
    "[**Dash HUD**](<https://egon.example/features/dash-hud>)",
  );
});

test("formatImplementationStart puts the catalog link on the feature name", () => {
  assert.equal(
    formatImplementationStart("Dash HUD", "https://egon.example/features/dash-hud"),
    `${PHASE_EMOJI.implementing} Implementation started for [**Dash HUD**](<https://egon.example/features/dash-hud>).`,
  );
  assert.equal(
    formatImplementationStart("Dash HUD"),
    `${PHASE_EMOJI.implementing} Implementation started for **Dash HUD**.`,
  );
});

test("formatTestingStart puts the catalog link on the feature name", () => {
  assert.equal(
    formatTestingStart("Dash HUD", "https://egon.example/features/dash-hud"),
    `${PHASE_EMOJI.testing} Testing started for [**Dash HUD**](<https://egon.example/features/dash-hud>)`,
  );
  assert.equal(
    formatTestingStart("Dash HUD"),
    `${PHASE_EMOJI.testing} Testing started for **Dash HUD**`,
  );
});

test("formatTestReport prefixes the testing emoji and aligns a monospace table", () => {
  const text = formatTestReport({
    overallPass: true,
    hasFailure: false,
    criteria: [
      { index: 1, status: "PASS", text: "canvas visible" },
      { index: 2, status: "PASS", text: "player jumps" },
    ],
    raw: "",
  });
  assert.equal(
    text,
    [
      `${PHASE_EMOJI.testing} **PASS**`,
      "```",
      "#  Result  Criterion",
      "1  PASS    canvas visible",
      "2  PASS    player jumps",
      "```",
    ].join("\n"),
  );
});

test("formatTestReport marks FAIL and flattens criterion text", () => {
  const text = formatTestReport({
    overallPass: false,
    hasFailure: true,
    criteria: [{ index: 1, status: "FAIL", text: "hud **broken**\nand wrapped" }],
    raw: "",
  });
  assert.equal(
    text,
    [
      `${PHASE_EMOJI.testing} **FAIL**`,
      "```",
      "#  Result  Criterion",
      "1  FAIL    hud **broken** and wrapped",
      "```",
    ].join("\n"),
  );
});

test("formatTestReport shows COULD NOT VERIFY in the per-criterion breakdown", () => {
  const text = formatTestReport({
    overallPass: true,
    hasFailure: false,
    criteria: [
      { index: 0, status: "PASS", text: "no SCRIPT ERROR in console" },
      { index: 1, status: "COULD_NOT_VERIFY", text: "projectile too fast" },
    ],
    raw: "",
  });
  assert.equal(
    text,
    [
      `${PHASE_EMOJI.testing} **PASS**`,
      "```",
      "#  Result            Criterion",
      "0  PASS              no SCRIPT ERROR in console",
      "1  COULD NOT VERIFY  projectile too fast",
      "```",
    ].join("\n"),
  );
});

test("formatTesterPassOutcome names unverified criteria instead of a clean pass", () => {
  assert.equal(
    formatTesterPassOutcome("Dash HUD", 0),
    "**Dash HUD** passed every acceptance criterion.",
  );
  assert.equal(
    formatTesterPassOutcome("Dash HUD", 0, "https://egon.example/features/dash-hud"),
    "[**Dash HUD**](<https://egon.example/features/dash-hud>) passed every acceptance criterion.",
  );
  assert.equal(
    formatTesterPassOutcome("Dash HUD", 1),
    "**Dash HUD** could not verify 1 acceptance criterion.",
  );
  assert.equal(
    formatTesterPassOutcome("Dash HUD", 2),
    "**Dash HUD** could not verify 2 acceptance criteria.",
  );
});

test("formatReviewReady links PR to GitHub and the feature name to the catalog", () => {
  assert.equal(
    formatReviewReady(
      "Dash HUD",
      "https://egon.example/features/dash-hud",
      "https://github.com/org/game/pull/12",
    ),
    `${PHASE_EMOJI.review} [PR](<https://github.com/org/game/pull/12>) ready for review: [**Dash HUD**](<https://egon.example/features/dash-hud>).`,
  );
  assert.equal(
    formatReviewReady("Dash HUD"),
    `${PHASE_EMOJI.review} PR ready for review: **Dash HUD**.`,
  );
});

test("formatNoteAdded includes the note text", () => {
  assert.equal(
    formatNoteAdded("Jump", "jump has to be higher"),
    "Added a note to **Jump**.\n*jump has to be higher*",
  );
  assert.equal(
    formatNoteAdded("Jump", "jump has to be higher", undefined, "https://egon.example/features/jump"),
    "Added a note to [**Jump**](<https://egon.example/features/jump>).\n*jump has to be higher*",
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

test("formatPivoting includes the change request", () => {
  assert.equal(
    formatPivoting("Jump", "make the HUD smaller"),
    "Pivoting **Jump**. Re-entering implement and test.\n*make the HUD smaller*",
  );
  assert.equal(
    formatPivoting("Jump", "make the HUD smaller", undefined, "https://egon.example/features/jump"),
    "Pivoting [**Jump**](<https://egon.example/features/jump>). Re-entering implement and test.\n*make the HUD smaller*",
  );
});

test("formatPivoting includes the asset path when an image was added", () => {
  assert.equal(
    formatPivoting("Jump", "match this HUD", "assets/egon/jump/hud.png"),
    "Pivoting **Jump**. Re-entering implement and test.\n*match this HUD*\nassets/egon/jump/hud.png",
  );
});

test("formatPivoting escapes player text", () => {
  assert.equal(
    formatPivoting("Dash *HUD*", "make it **bigger**"),
    "Pivoting **Dash \\*HUD\\***. Re-entering implement and test.\n*make it \\*\\*bigger\\*\\**",
  );
});

test("formatDeploySuccess is a one-liner with live play link", () => {
  assert.equal(
    formatDeploySuccess({
      title: "[**Dash HUD**](<https://egon.example/features/dash-hud>)",
      gameUrl: "https://game.example",
    }),
    "✅ Successfully deployed feature [**Dash HUD**](<https://egon.example/features/dash-hud>). You can [test it live](<https://game.example>) now!",
  );
});

test("formatDeployFailure links the workflow run", () => {
  assert.equal(
    formatDeployFailure({
      title: "org/game",
      repoUrl: "https://github.com/org/game",
      gameUrl: "https://game.example",
      durationMinutes: 2,
      commitMessage: "broken",
      workflowUrl: "https://github.com/org/game/actions/runs/9",
    }),
    [
      "**❌ Deploy failed: org/game**",
      "- **Workflow**: <https://github.com/org/game/actions/runs/9>",
      "- **Commit**: broken",
    ].join("\n"),
  );
});
