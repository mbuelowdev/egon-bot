import { Agent, type SDKUserMessage } from "@cursor/sdk";
import type { Config } from "../config.js";
import { featureAssetDir } from "../features/artifacts.js";
import type { Feature, FeatureAttachment, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { createAskDiscordUsersTool, type AskUsersDeps } from "./askUsersTool.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { agentUserMessage, attachmentPromptLines, loadCursorImages } from "./images.js";
import { parsePlanMarker, type PlanMarker } from "./planMarker.js";
import { featurePaths, MAX_ACCEPTANCE_CRITERIA } from "./testReport.js";

export function plannerPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    "You are the Egon planner for a Godot web game in this working tree.",
    `Feature name: ${feature.name}`,
    `Write ONLY this file: docs/features/${slug}/SPEC.md`,
    "You are on a feature branch. Do not write any other files. Do not commit or push.",
    "You may read existing game code to ground the spec.",
    "",
    `The spec MUST include an **Acceptance criteria** section: a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} concrete, browser-verifiable checks (what to do, and what must be visible or true). Never write more than ${String(MAX_ACCEPTANCE_CRITERIA)} criteria.`,
    "",
    "Feature notes from Discord:",
    noteBlock,
    ...attachmentPromptLines(attachmentsDir, featureAssetDir(slug), attachments.length, false),
    "",
    "If you need a human decision, call ask_discord_users with a clear question and up to 3 numbered choices (1, 2, 3) plus Other. Wait for the answer.",
    "When finished, end your last message with a one-line marker exactly: PLAN_COMPLETE or PLAN_BLOCKED.",
  ].join("\n");
}

export function buildPlannerSendMessage(options: {
  feature: Feature;
  notes: string[];
  attachments: FeatureAttachment[];
  dataDir: string;
  followUp?: string;
}): string | SDKUserMessage {
  if (options.followUp !== undefined) {
    return options.followUp;
  }
  const attachmentsDir = featurePaths(options.dataDir, options.feature.id).attachmentsDir;
  const text = plannerPrompt(options.feature, options.notes, attachmentsDir, options.attachments);
  return agentUserMessage(
    text,
    loadCursorImages(options.dataDir, options.feature.id, options.attachments),
  );
}

export async function runPlanner(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  deps: AskUsersDeps;
  followUp?: string;
}): Promise<{ marker: PlanMarker | null; text?: string; agentId: string }> {
  const customTools = { ask_discord_users: createAskDiscordUsersTool(options.deps) };
  const base = localAgentOptions(options.config, customTools);
  const createOptions = {
    ...base,
    disallowedTools: ["shell" as const],
  };
  const agent = options.feature.plannerAgentId
    ? await Agent.resume(options.feature.plannerAgentId, createOptions)
    : await Agent.create(createOptions);
  options.store.setPlannerAgentId(options.feature.id, agent.agentId);
  try {
    const message = buildPlannerSendMessage({
      feature: options.feature,
      notes: options.store.listNotes(options.feature.id),
      attachments: options.store.listAttachments(options.feature.id),
      dataDir: options.config.dataDir,
      followUp: options.followUp,
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
