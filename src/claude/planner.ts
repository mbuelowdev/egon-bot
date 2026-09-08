import type { Config } from "../config.js";
import type { Feature, FeatureAttachment, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { loadGameDecisionsMarkdown } from "../features/gameDecisions.js";
import { loadGameMapMarkdown } from "../godot/gameMap.js";
import { describedAssets, type AssetMeta } from "../assets/store.js";
import type { AskUsersDeps } from "../cursor/askQuestions.js";
import { loadCursorImages } from "../cursor/images.js";
import { parsePlanMarker, type PlanMarker } from "../cursor/planMarker.js";
import { PLANNER_INSTRUCTIONS, plannerUserPrompt } from "../cursor/plannerPrompt.js";
import { featurePaths } from "../cursor/testReport.js";
import { plannerWritablePaths } from "./permissions.js";
import { buildClaudeUserPrompt, queryPlanner } from "./query.js";

export function claudePlannerSystemPrompt(): string {
  return [
    PLANNER_INSTRUCTIONS,
    "Write ONLY the spec file path given in the user message.",
    "Do not use Bash, subagents, or the web. A later, separate implementer has shell access; do not treat your own lack of web access as a game constraint.",
    "Write the spec with the Write/Edit tools. Do not draft the entire SPEC in thinking and then write it again as the reply.",
  ].join("\n");
}

export function claudePlannerUserPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
  gameMap = "",
  gameDecisions = "",
  assets: AssetMeta[] = [],
): string {
  return plannerUserPrompt(
    feature,
    notes,
    attachmentsDir,
    attachments,
    gameMap,
    gameDecisions,
    assets,
  );
}

export async function runClaudePlanner(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  deps: AskUsersDeps;
  followUp?: string;
}): Promise<{ marker: PlanMarker | null; text?: string; agentId: string }> {
  const slug = featureSlug(options.feature.name);
  const writablePaths = plannerWritablePaths(slug);
  const resume =
    options.feature.plannerBackend === "claude" && options.feature.plannerAgentId
      ? options.feature.plannerAgentId
      : undefined;
  const attachmentsDir = featurePaths(options.config.dataDir, options.feature.id).attachmentsDir;
  const notes = options.store.listNotes(options.feature.id);
  const attachments = options.store.listAttachments(options.feature.id);
  const userText =
    options.followUp ??
    claudePlannerUserPrompt(
      options.feature,
      notes,
      attachmentsDir,
      attachments,
      loadGameMapMarkdown(options.config),
      loadGameDecisionsMarkdown(options.config),
      describedAssets(options.config.dataDir),
    );
  const images =
    options.followUp === undefined
      ? loadCursorImages(options.config.dataDir, options.feature.id, attachments)
      : [];
  const result = await queryPlanner({
    config: options.config,
    deps: options.deps,
    specPath: writablePaths,
    systemPrompt: claudePlannerSystemPrompt(),
    prompt: buildClaudeUserPrompt(userText, images),
    resume,
    logText:
      images.length > 0
        ? `${userText}\n(${String(images.length)} ${images.length === 1 ? "image" : "images"})`
        : userText,
    onSession: (sessionId) => {
      options.store.setPlannerBackend(options.feature.id, "claude");
      options.store.setPlannerAgentId(options.feature.id, sessionId);
    },
  });
  const agentId =
    result.sessionId !== ""
      ? result.sessionId
      : (options.store.getFeatureById(options.feature.id)?.plannerAgentId ?? "");
  if (result.status !== "finished") {
    return {
      marker: "PLAN_BLOCKED",
      text: result.errorMessage ?? result.status,
      agentId,
    };
  }
  return { marker: parsePlanMarker(result.result), text: result.result, agentId };
}
