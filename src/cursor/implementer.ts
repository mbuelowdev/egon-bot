import { readFileSync } from "node:fs";
import { Agent, type SDKUserMessage } from "@cursor/sdk";
import type { Config } from "../config.js";
import { gameSpecPath } from "../features/artifacts.js";
import type { Feature, FeatureAttachment, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { featureBranchDiff } from "../git/workingTree.js";
import { ensureEgonBridge } from "../godot/egonBridge.js";
import { gameMapPromptSection, loadGameMapMarkdown } from "../godot/gameMap.js";
import { declaredAssetsPromptSection } from "../assets/manifest.js";
import { describedAssets, type AssetMeta } from "../assets/store.js";
import { declaredAssetIds } from "../features/specSections.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { ensureGodotCliGuide, GODOT_CLI_GUIDE } from "./godotCli.js";
import { GODOT_WEB_GOTCHAS_PROMPT } from "./godotWebGotchas.js";
import {
  agentUserMessage,
  attachmentPromptLines,
  loadCursorImages,
  type CursorImageFile,
} from "./images.js";
import { IMPLEMENTER_SUMMARY_PROMPT, IMPLEMENTER_SUMMARY_REMINDER } from "./implementerSummary.js";
import { featurePaths, parseAcceptanceCriteria } from "./testReport.js";

function loadAcceptanceCriteria(config: Config, feature: Feature): string[] {
  try {
    return parseAcceptanceCriteria(readFileSync(gameSpecPath(config, feature), "utf8"));
  } catch {
    return [];
  }
}

function acceptanceCriteriaPromptSection(criteria: string[]): string[] {
  if (criteria.length === 0) {
    return [];
  }
  return [
    "Acceptance criteria:",
    ...criteria.map((item, index) => `${String(index + 1)}. ${item}`),
    "",
  ];
}

function loadSpecMarkdown(config: Config, feature: Feature): string {
  try {
    return readFileSync(gameSpecPath(config, feature), "utf8");
  } catch {
    return "";
  }
}

/**
 * Only the ids this SPEC declared, never the catalog. Handing the implementer the whole
 * library invites it to reach for an asset the spec never declared, which promotion never
 * copied into the repo, producing a broken `res://` reference.
 */
export function declaredAssetsFor(
  config: Config,
  feature: Feature,
): { ids: string[]; assets: AssetMeta[] } {
  const ids = declaredAssetIds(loadSpecMarkdown(config, feature));
  return { ids, assets: ids.length === 0 ? [] : describedAssets(config.dataDir) };
}

/** Bounded seed for a new implementer after earlier test cycles (no prior conversation). */
export function freshFixSeedAppendix(spec: string, gitDiff: string, report: string): string {
  const specBody = spec.trim();
  const diffBody = gitDiff.trim() === "" ? "(no changes vs default branch)" : gitDiff.trim();
  return [
    "This is a fresh implementer after earlier test cycles. There is no prior conversation.",
    "The working tree already has this feature's work. Fix the failures below. Do not commit or push.",
    specBody === "" ? undefined : `SPEC:\n${specBody}`,
    `Git diff vs the default branch:\n${diffBody}`,
    report.trim() === "" ? undefined : report.trim(),
  ]
    .filter((block): block is string => block !== undefined)
    .join("\n\n");
}

export function implementerPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
  gameMap = "",
  criteria: string[] = [],
  declaredAssets: { ids: string[]; assets: AssetMeta[] } = { ids: [], assets: [] },
): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    "You are the Egon implementer for a Godot web game in this working tree.",
    "You are on a feature branch. Download any http(s) asset URLs found in the feature notes into the Godot project.",
    "Do not git commit. Do not git push.",
    "Modify only the files the SPEC's Relevant files section lists, plus files you create; anything else must be justified under Deviations.",
    "",
    "Verify edits with the Godot CLI before finishing. Always --headless --path . Never --test, --editor/-e, or --debug unattended (they hang).",
    "Follow the loop: import → parse-check changed .gd → smoke-run (--quit-after or --scene) → grep the log.",
    "Always rg -n --max-count 20; never cat a Godot log.",
    "Write logs under /tmp. Do not Web-export; the orchestrator exports after you finish.",
    "Fix SCRIPT ERROR / ERROR: / parse/compile failures before finishing.",
    "",
    "Scenarios are your job. Build every scenario the SPEC Test scenarios section declares new, as `egon/scenarios/{name}.gd` exposing `func apply() -> void:` that puts the game into that state using the game's own setters and scene changes. Give each one a leading `##` doc comment saying what state it establishes; that line is what later planners see. Reuse an existing scenario exactly as named — never fork one under a new spelling.",
    "Verify each scenario you touched headless before finishing: run it with `-- --egon-scenario=NAME` and confirm the log prints EGON_SCENARIO_ACTIVE for that name. EGON_SCENARIO_UNKNOWN means it never registered.",
    "Keep the existing scenarios green. Scenarios are code that normal play never exercises, so they rot silently. If your change touches state a registered scenario depends on, repair that scenario in the same run — a later feature's regression checks depend on it still working.",
    "",
    IMPLEMENTER_SUMMARY_PROMPT,
    "",
    "Godot CLI:",
    GODOT_CLI_GUIDE,
    "",
    GODOT_WEB_GOTCHAS_PROMPT,
    "",
    ...gameMapPromptSection(gameMap),
    `Feature name: ${feature.name}`,
    `Implement the spec at docs/features/${slug}/SPEC.md. Honor Scope, Out of scope, Assets, Implementation notes, Verification hooks, and Explicitly NOT this task. Register every Verification hooks field with \`get_node("/root/EgonBridge").register_field\` — not the \`EgonBridge\` autoload identifier, which \`--check-only\` does not define. Build the scenarios its Test scenarios section declares. Self-check Acceptance criteria before finishing by running each scenario headless with \`-- --egon-scenario=NAME\` and reading \`get_node("/root/EgonBridge").snapshot()\` in a headless \`--quit-after\` run. Do not do anything the spec marks out of scope.`,
    "",
    ...acceptanceCriteriaPromptSection(criteria),
    ...declaredAssetsPromptSection(declaredAssets.ids, declaredAssets.assets),
    "Feature notes:",
    noteBlock,
    ...attachmentPromptLines(attachmentsDir, attachments.length, true),
  ].join("\n");
}

export function buildImplementerSendMessage(options: {
  feature: Feature;
  notes: string[];
  attachments: FeatureAttachment[];
  dataDir: string;
  followUp?: string;
  followUpAttachments?: CursorImageFile[];
  gameMap?: string;
  criteria?: string[];
  declaredAssets?: { ids: string[]; assets: AssetMeta[] };
  fresh?: boolean;
  spec?: string;
  gitDiff?: string;
}): string | SDKUserMessage {
  if (options.followUp !== undefined && !options.fresh) {
    const followUp = options.followUp.includes(IMPLEMENTER_SUMMARY_REMINDER)
      ? options.followUp
      : `${options.followUp}\n${IMPLEMENTER_SUMMARY_REMINDER}`;
    return agentUserMessage(
      followUp,
      loadCursorImages(options.dataDir, options.feature.id, options.followUpAttachments ?? []),
    );
  }
  const attachmentsDir = featurePaths(options.dataDir, options.feature.id).attachmentsDir;
  let text = implementerPrompt(
    options.feature,
    options.notes,
    attachmentsDir,
    options.attachments,
    options.gameMap ?? "",
    options.criteria ?? [],
    options.declaredAssets,
  );
  if (options.fresh && options.followUp !== undefined) {
    text = `${text}\n\n${freshFixSeedAppendix(options.spec ?? "", options.gitDiff ?? "", options.followUp)}`;
  }
  const images = [
    ...loadCursorImages(options.dataDir, options.feature.id, options.attachments),
    ...loadCursorImages(options.dataDir, options.feature.id, options.followUpAttachments ?? []),
  ];
  return agentUserMessage(text, images);
}

export async function runImplementer(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  followUp?: string;
  followUpAttachments?: CursorImageFile[];
  fresh?: boolean;
}): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string; agentId: string }> {
  ensureGodotCliGuide(options.config.gameRepoDir);
  ensureEgonBridge(options.config.gameRepoDir);
  const base = localAgentOptions(options.config, "implementer");
  const agent =
    options.fresh || !options.feature.implementerAgentId
      ? await Agent.create(base)
      : await Agent.resume(options.feature.implementerAgentId, base);
  options.store.setImplementerAgentId(options.feature.id, agent.agentId);
  try {
    const spec = options.fresh ? loadSpecMarkdown(options.config, options.feature) : undefined;
    const gitDiff = options.fresh ? await featureBranchDiff(options.config) : undefined;
    const message = buildImplementerSendMessage({
      feature: options.feature,
      notes: options.store.listNotes(options.feature.id),
      attachments: options.store.listAttachments(options.feature.id),
      dataDir: options.config.dataDir,
      followUp: options.followUp,
      followUpAttachments: options.followUpAttachments,
      gameMap: loadGameMapMarkdown(options.config),
      criteria: loadAcceptanceCriteria(options.config, options.feature),
      declaredAssets: declaredAssetsFor(options.config, options.feature),
      fresh: options.fresh,
      spec,
      gitDiff,
    });
    const result = await sendAndWait(
      agent,
      message,
      options.followUp && !options.fresh ? { local: { force: true } } : undefined,
      { config: options.config, featureId: options.feature.id, role: "implementer" },
    );
    return { ...result, agentId: agent.agentId };
  } finally {
    await disposeAgent(agent);
  }
}
