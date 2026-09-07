import { Agent, type SDKUserMessage } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature, FeatureAttachment, FeatureStore } from "../features/store.js";
import { loadGameDecisionsMarkdown } from "../features/gameDecisions.js";
import { loadGameMapMarkdown } from "../godot/gameMap.js";
import { createAskDiscordUsersTool, type AskUsersDeps } from "./askUsersTool.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { agentUserMessage, loadCursorImages } from "./images.js";
import { parsePlanMarker, type PlanMarker } from "./planMarker.js";
import { PLANNER_INSTRUCTIONS, plannerUserPrompt } from "./plannerPrompt.js";
import { featurePaths } from "./testReport.js";

export function plannerPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
  gameMap = "",
  gameDecisions = "",
): string {
  return [
    PLANNER_INSTRUCTIONS,
    "",
    plannerUserPrompt(feature, notes, attachmentsDir, attachments, gameMap, gameDecisions),
  ].join("\n");
}

export function buildPlannerSendMessage(options: {
  feature: Feature;
  notes: string[];
  attachments: FeatureAttachment[];
  dataDir: string;
  followUp?: string;
  answersAppendix?: string;
  gameMap?: string;
  gameDecisions?: string;
}): string | SDKUserMessage {
  if (options.followUp !== undefined) {
    return options.followUp;
  }
  const attachmentsDir = featurePaths(options.dataDir, options.feature.id).attachmentsDir;
  let text = plannerPrompt(
    options.feature,
    options.notes,
    attachmentsDir,
    options.attachments,
    options.gameMap ?? "",
    options.gameDecisions ?? "",
  );
  if (options.answersAppendix !== undefined && options.answersAppendix !== "") {
    text = `${text}\n\n${options.answersAppendix}`;
  }
  return agentUserMessage(
    text,
    loadCursorImages(options.dataDir, options.feature.id, options.attachments),
  );
}

export async function runCursorPlanner(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  deps: AskUsersDeps;
  followUp?: string;
  answersAppendix?: string;
}): Promise<{ marker: PlanMarker | null; text?: string; agentId: string }> {
  const customTools = { ask_discord_users: createAskDiscordUsersTool(options.deps) };
  const base = localAgentOptions(options.config, "planner", customTools);
  const createOptions = {
    ...base,
    disallowedTools: ["shell" as const],
  };
  const agent = options.feature.plannerAgentId
    ? await Agent.resume(options.feature.plannerAgentId, createOptions)
    : await Agent.create(createOptions);
  options.store.setPlannerBackend(options.feature.id, "cursor");
  options.store.setPlannerAgentId(options.feature.id, agent.agentId);
  try {
    const message = buildPlannerSendMessage({
      feature: options.feature,
      notes: options.store.listNotes(options.feature.id),
      attachments: options.store.listAttachments(options.feature.id),
      dataDir: options.config.dataDir,
      followUp: options.followUp,
      answersAppendix: options.answersAppendix,
      gameMap: loadGameMapMarkdown(options.config),
      gameDecisions: loadGameDecisionsMarkdown(options.config),
    });
    const result = await sendAndWait(
      agent,
      message,
      {
        local: {
          customTools,
          ...(options.followUp ? { force: true } : {}),
        },
      },
      { config: options.config, featureId: options.feature.id, role: "planner" },
    );
    if (result.status !== "finished") {
      return {
        marker: "PLAN_BLOCKED",
        text: result.errorMessage ?? result.status,
        agentId: agent.agentId,
      };
    }
    return { marker: parsePlanMarker(result.result), text: result.result, agentId: agent.agentId };
  } finally {
    await disposeAgent(agent);
  }
}
