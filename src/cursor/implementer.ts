import { Agent } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";

function implementerPrompt(feature: Feature, notes: string[]): string {
  const slug = featureSlug(feature.name);
  const noteBlock = notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "(none)";
  return [
    "You are the Egon implementer for a Godot web game in this working tree.",
    `Implement the spec at docs/features/${slug}/SPEC.md and nothing else that is out of scope for that spec.`,
    "You are on a feature branch. Download any http(s) asset URLs found in the feature notes into the Godot project.",
    "Bump the version field in deployment.json (changing that file triggers deploy when the PR merges).",
    "Do not git commit. Do not git push.",
    "",
    "Feature notes:",
    noteBlock,
  ].join("\n");
}

export async function runImplementer(options: {
  config: Config;
  store: FeatureStore;
  feature: Feature;
  followUp?: string;
}): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string; agentId: string }> {
  const base = localAgentOptions(options.config);
  const agent = options.feature.implementerAgentId
    ? await Agent.resume(options.feature.implementerAgentId, base)
    : await Agent.create(base);
  options.store.setImplementerAgentId(options.feature.id, agent.agentId);
  try {
    const message =
      options.followUp ??
      implementerPrompt(options.feature, options.store.listNotes(options.feature.id));
    const result = await sendAndWait(
      agent,
      message,
      options.followUp ? { local: { force: true } } : undefined,
    );
    return { ...result, agentId: agent.agentId };
  } finally {
    await disposeAgent(agent);
  }
}
