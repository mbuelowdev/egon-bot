import type { SDKCustomTool } from "@cursor/sdk";
import type { Client } from "discord.js";
import type { Config } from "../config.js";
import { postToChannel } from "../discord/channel.js";
import { waitForThreadAnswer } from "../discord/qaWaiters.js";
import type { FeatureStore } from "../features/store.js";

export type AskUsersDeps = {
  client: Client;
  store: FeatureStore;
  config: Config;
  featureId: number;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createAskDiscordUsersTool(deps: AskUsersDeps): SDKCustomTool {
  return {
    description:
      "Ask the humans in Discord a clarifying question. Use this when the spec cannot be finished without a decision. The first thread reply that mentions the bot is the answer.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to post in Discord",
        },
      },
      required: ["question"],
    },
    annotations: {
      title: "Ask Discord users",
      openWorldHint: true,
    },
    async execute(args) {
      const question = asString(args.question).trim();
      if (question === "") {
        return { content: [{ type: "text", text: "question is required" }], isError: true };
      }
      const feature = deps.store.getFeatureById(deps.featureId);
      if (!feature) {
        return { content: [{ type: "text", text: "Feature not found" }], isError: true };
      }
      const botMention = deps.client.user ? `<@${deps.client.user.id}>` : "the bot";
      const prompt = [
        `**Planner question for ${feature.name}**`,
        question,
        "",
        `Reply in this thread and mention ${botMention} with your answer.`,
      ].join("\n");

      deps.store.setPendingQuestion(feature.id, question);

      let threadId = feature.discordThreadId;
      if (threadId) {
        const thread = await deps.client.channels.fetch(threadId);
        if (thread?.isTextBased() && !thread.isDMBased()) {
          const posted = await thread.send(prompt);
          deps.store.setDiscordIds(feature.id, { messageId: posted.id, threadId });
        } else {
          threadId = null;
        }
      }
      if (!threadId) {
        const posted = await postToChannel(deps.client, deps.config.discordChannelId, prompt);
        const started = await posted.startThread({
          name: `plan-${feature.name}`.slice(0, 100),
        });
        threadId = started.id;
        deps.store.setDiscordIds(feature.id, { messageId: posted.id, threadId });
      }

      try {
        const answer = await waitForThreadAnswer(threadId);
        deps.store.clearPendingQuestion(feature.id);
        return `The humans answered:\n${answer}`;
      } catch (error) {
        deps.store.clearPendingQuestion(feature.id);
        const message = error instanceof Error ? error.message : "Unknown Q&A error";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  };
}
