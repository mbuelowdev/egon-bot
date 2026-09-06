import { Agent, type SDKUserMessage } from "@cursor/sdk";
import type { Config } from "../config.js";
import { featureAssetDir } from "../features/artifacts.js";
import type { Feature, FeatureAttachment, FeatureStore } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { agentUserMessage, attachmentPromptLines, loadCursorImages } from "./images.js";
import { featurePaths } from "./testReport.js";

export function implementerPrompt(
  feature: Feature,
  notes: string[],
  attachmentsDir: string,
  attachments: FeatureAttachment[],
): string {
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
    ...attachmentPromptLines(attachmentsDir, featureAssetDir(slug), attachments.length, true),
  ].join("\n");
}

export function buildImplementerSendMessage(options: {
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
  const text = implementerPrompt(options.feature, options.notes, attachmentsDir, options.attachments);
  return agentUserMessage(
    text,
    loadCursorImages(options.dataDir, options.feature.id, options.attachments),
  );
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
    const message = buildImplementerSendMessage({
      feature: options.feature,
      notes: options.store.listNotes(options.feature.id),
      attachments: options.store.listAttachments(options.feature.id),
      dataDir: options.config.dataDir,
      followUp: options.followUp,
    });
    const result = await sendAndWait(
      agent,
      message,
      options.followUp ? { local: { force: true } } : undefined,
      { config: options.config, featureId: options.feature.id, role: "implementer" },
    );
    return { ...result, agentId: agent.agentId };
  } finally {
    await disposeAgent(agent);
  }
}
