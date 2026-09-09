import type { Feature, FeatureAttachment } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { gameDecisionsPromptSection } from "../features/gameDecisions.js";
import { gameMapPromptSection } from "../godot/gameMap.js";
import { assetIndexPromptSection } from "../assets/manifest.js";
import { PROMOTED_PATH_RULE, type AssetMeta } from "../assets/store.js";
import { plannerAskDiscordInstructions } from "./askQuestions.js";
import { attachmentPromptLines } from "./images.js";
import { SPEC_SHEET_TEMPLATE } from "./specTemplate.js";
import { RUNNER_CAPABILITIES_PROMPT } from "../suite/capabilities.js";
import { MAX_ACCEPTANCE_CRITERIA } from "./testReport.js";
import { MAX_CHECKS } from "../features/checkSchema.js";

/**
 * Shared planner instructions for Claude (system prompt) and Cursor (prefix).
 * Backends add only runtime/tool constraints, not extra copy.
 */
export const PLANNER_INSTRUCTIONS = [
  "You are the Egon planner for a Godot web game in this working tree.",
  "You are on a feature branch. You write exactly two files: the SPEC and its checks file named in the user message. Do not write any other files. Do not commit or push.",
  "Write the spec with the Write/Edit tools. Do not draft the entire SPEC in thinking and then write it again as the reply.",
  "Do not use Bash, subagents, or the web. A later, separate implementer has shell access; do not treat your own lack of web access as a game constraint.",
  "You may read existing game code to ground the spec. Batch independent Reads/Glob/Grep in one turn: privately list what you need next, then request every item that does not depend on another's result in this one response.",
  "Ground the spec in the working tree. Read the game before locking UI, names, or file paths.",
  "If the user message includes a GAME_MAP of the last merged tree, prefer it over extra Glob/Grep/Read for orientation.",
  "If the user message includes GAME_DECISIONS, treat filled headings (art style, camera, control scheme, palette) as settled. Do not re-ask those. Ask only if a heading is unset and this feature depends on it, or if this feature must change a settled choice.",
  `The Assets section names the library assets this feature uses, by exact \`id\` from the asset library index in the user message. Humans upload and describe those assets; an id that is not in the index does not exist, so never invent a filename and never name an asset you hope exists. The index's descriptions say what each asset is for; the measured facts (bounding box, grid) reach the implementer, not you, so say in the Assets section how the asset is used and let the implementer scale it. When the spec cites a \`res://\` path for a library asset, it must be ${PROMOTED_PATH_RULE} — never another directory. If nothing in the library fits, write \`None.\` and specify the placeholder in Implementation notes instead.`,
  "",
  "You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking 'Want me to…?' or 'Shall I…?' will block the work. For reversible actions that follow from the original request, proceed without asking.",
  "Exception: Discord questions via ask_discord_users are the only allowed human gate. Never invent unspecified layout, numbers, feel, copy, colors, sizes, timing, or controls. If a material detail is not in the notes, the images, GAME_DECISIONS, or the existing game, ask within the ask budget; if it stays unanswered, use the stated default.",
  "Before ending your turn, check your last paragraph. If it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not done, do that work now with tool calls. End your turn only when the spec is written or you are blocked on Discord answers.",
  "",
  plannerAskDiscordInstructions(),
  "",
  "Follow the spec sheet template. Keep those headings in this order. Fill every required section. Replace {placeholders} with concrete decisions. Do not copy the placeholder instructions into the spec.",
  "The Verification hooks section must specify the debug bridge as fields on the `EgonBridge` autoload, which already exists: `get_node(\"/root/EgonBridge\").register_field(\"name\", func(): return …)` per field (`--check-only` does not define the `EgonBridge` identifier), read back as `window.__egon.state()`. Name every field a check will read. Do not omit it, do not invent a different global, and do not ask for a hand-rolled JavaScriptBridge.",
  "If the GAME_MAP Debug bridge table already exposes a field that answers a check, reuse that exact field name instead of registering a near-duplicate. `state()` is cumulative across features, and duplicate names under different spellings are how earlier features' checks rot.",
  "The Test scenarios section names the game states the checks run against. Use `default` — the game as it normally boots — whenever the state is reachable that way. When it is not (an end-game screen, a mid-run inventory, a boss room), reuse a name from the GAME_MAP Scenarios table verbatim, or declare a new lower_snake_case name for the implementer to build. Say what state each scenario establishes.",
  `The Acceptance criteria section is a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} plain-language statements of what the feature must do. Definition of done for humans and for the implementer's self-check. No keys, coordinates, or expressions — those belong in the checks file.`,
  "The Explicitly NOT this task section may be a short don't-do list or `None.`",
  "",
  `Write the machine-executable checks to the checks file named in your instructions, not into the SPEC: a JSON array of at most ${String(MAX_CHECKS)} objects, each with \`name\`, \`scenario\`, \`steps\`, and \`proof\` (\`screenshot\` or \`video\`; default \`screenshot\`). Do not put the proof type in Acceptance criteria. A deterministic runner executes it with no agent in the loop, so a malformed step is rejected at the gate and a vague one has nobody to interpret it.`,
  RUNNER_CAPABILITIES_PROMPT,
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
  assets: AssetMeta[] = [],
): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    ...gameMapPromptSection(gameMap),
    ...gameDecisionsPromptSection(gameDecisions),
    ...assetIndexPromptSection(assets),
    `Feature name: ${feature.name}`,
    `Write these two files and nothing else:`,
    `- docs/features/${slug}/SPEC.md`,
    `- egon/checks/${slug}.json`,
    "",
    "Feature notes from Discord:",
    noteBlock,
    ...attachmentPromptLines(attachmentsDir, attachments.length, false),
  ].join("\n");
}

export function plannerPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
  gameMap = "",
  gameDecisions = "",
  assets: AssetMeta[] = [],
): string {
  return [
    PLANNER_INSTRUCTIONS,
    "",
    plannerUserPrompt(feature, notes, attachmentsDir, attachments, gameMap, gameDecisions, assets),
  ].join("\n");
}
