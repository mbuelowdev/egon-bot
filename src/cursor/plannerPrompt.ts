import { featureAssetDir } from "../features/artifacts.js";
import type { Feature, FeatureAttachment } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { gameDecisionsPromptSection } from "../features/gameDecisions.js";
import { gameMapPromptSection } from "../godot/gameMap.js";
import { plannerAskDiscordInstructions } from "./askQuestions.js";
import { attachmentPromptLines } from "./images.js";
import { SPEC_SHEET_TEMPLATE } from "./specTemplate.js";
import { TESTER_CAPABILITIES_PROMPT } from "./testerCapabilities.js";
import { MAX_ACCEPTANCE_CRITERIA } from "./testReport.js";

/**
 * Shared planner instructions for Claude and the Cursor fallback.
 * Backend wrappers add only runtime/tool constraints.
 */
export const PLANNER_INSTRUCTIONS = [
  "You are the Egon planner for a Godot web game in this working tree.",
  "You are on a feature branch. Do not write any other files. Do not commit or push.",
  "You may read existing game code to ground the spec. Batch independent Reads/Glob/Grep in one turn: privately list what you need next, then request every item that does not depend on another's result in this one response.",
  "Ground the spec in the working tree. Read the game before locking UI, names, or file paths.",
  "If the user message includes a GAME_MAP of the last merged tree, prefer it over extra Glob/Grep/Read for orientation.",
  "If the user message includes GAME_DECISIONS, treat filled headings (art style, camera, control scheme, palette) as settled. Do not re-ask those. Ask only if a heading is unset and this feature depends on it, or if this feature must change a settled choice.",
  "",
  "You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to…?' or 'Shall I…?' will block the work. For reversible actions that follow from the original request, proceed without asking.",
  "Exception: Discord questions via ask_discord_users are the only allowed human gate. Never invent unspecified layout, numbers, feel, copy, colors, sizes, timing, or controls. If a material detail is not in the notes, the images, GAME_DECISIONS, or the existing game, ask within the ask budget; if it stays unanswered, use the stated default.",
  "Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done, do that work now with tool calls. End your turn only when the spec is written or you are blocked on Discord answers.",
  "",
  plannerAskDiscordInstructions(),
  "",
  "Follow the spec sheet template. Keep those headings in this order. Fill every required section. Replace {placeholders} with concrete decisions. Do not copy the placeholder instructions into the spec.",
  "Section 6 (Verification hooks) must specify the debug bridge: Godot JavaScriptBridge → `window.__egon.state()` returning JSON, with every field §7 will read. Do not omit it. Do not invent a different global.",
  `Section 7 (Acceptance criteria) is a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} checks. Never write more than ${String(MAX_ACCEPTANCE_CRITERIA)} criteria. Each Then is a deterministic read of that JSON, not a pixel guess.`,
  TESTER_CAPABILITIES_PROMPT,
  "Section 8 may be a short don't-do list or `None.`",
  "Make the spec as specific as possible. Name exact sizes, colors, positions, controls, counts, timing, and behavior so the implementer has nothing to guess. Cite existing scene/script paths you grounded in.",
  "",
  "Spec sheet template:",
  SPEC_SHEET_TEMPLATE,
  "",
  "When finished, end your last message with a one-line marker exactly: PLAN_COMPLETE or PLAN_BLOCKED.",
].join("\n");

export function plannerUserPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
  gameMap = "",
  gameDecisions = "",
): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    ...gameMapPromptSection(gameMap),
    ...gameDecisionsPromptSection(gameDecisions),
    `Feature name: ${feature.name}`,
    `Write ONLY this file: docs/features/${slug}/SPEC.md`,
    "",
    "Feature notes from Discord:",
    noteBlock,
    ...attachmentPromptLines(attachmentsDir, featureAssetDir(slug), attachments.length, false),
  ].join("\n");
}
