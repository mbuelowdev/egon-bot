import { Agent } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { createAskDiscordUsersTool, type AskUsersDeps } from "./askUsersTool.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { parsePlanMarker, type PlanMarker } from "./planMarker.js";

function plannerPrompt(feature: Feature, notes: string[]): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    "You are the Egon planner for a Godot web game in this working tree.",
    `Feature name: ${feature.name}`,
    `Write ONLY this file: docs/features/${slug}/SPEC.md`,
    "You are on a feature branch. Do not write any other files. Do not commit or push.",
    "You may read existing game code to ground the spec.",
    "",
    "The spec MUST include an **Acceptance criteria** section: a numbered list of concrete, browser-verifiable checks (what to do, and what must be visible or true).",
    "",
    "Feature notes from Discord:",
    noteBlock,
    "",
    "If you need a human decision, call ask_discord_users and wait for the answer.",
    "When finished, end your last message with a one-line marker exactly: PLAN_COMPLETE or PLAN_BLOCKED.",
  ].join("\n");
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
    const message =
      options.followUp ?? plannerPrompt(options.feature, options.store.listNotes(options.feature.id));
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
