import type { SDKCustomTool } from "@cursor/sdk";
import type { Client } from "discord.js";
import { featurePageUrl, type Config } from "../config.js";
import { answerButtonRow, formatQuestionBody, normalizeChoices, parseNumberedChoices } from "../discord/answerButtons.js";
import { postToChannel } from "../discord/channel.js";
import { waitForQuestionAnswer } from "../discord/qaWaiters.js";
import { formatFeatureName, PHASE_EMOJI } from "../format.js";
import type { Feature, FeatureStore } from "../features/store.js";
import { beginAgentIdle, endAgentIdle } from "./agentIdle.js";

export type AskUsersDeps = {
  client: Client;
  store: FeatureStore;
  config: Config;
  featureId: number;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function postPlannerQuestion(
  deps: AskUsersDeps,
  feature: Pick<Feature, "id" | "name">,
  question: string,
): Promise<void> {
  const choices = parseNumberedChoices(question);
  const prompt = [
    `${PHASE_EMOJI.planning} Planner question for ${formatFeatureName(feature.name, featurePageUrl(deps.config, feature.name))}`,
    question,
  ].join("\n\n");
  const posted = await postToChannel(deps.client, deps.config.discordChannelId, prompt, {
    components: [answerButtonRow(feature.id, choices.length)],
  });
  deps.store.setDiscordIds(feature.id, { messageId: posted.id });
}

export function createAskDiscordUsersTool(deps: AskUsersDeps): SDKCustomTool {
  return {
    description:
      "Ask the humans in Discord a clarifying question. Prefer up to 3 numbered choices (1, 2, 3); they can also pick Answer other. The first button click or typed answer wins.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to post in Discord. Include numbered options 1, 2, 3 in the text when possible.",
        },
        choices: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
          description: "Up to 3 answer options. Humans can also pick Answer other.",
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
      const body = formatQuestionBody(question, normalizeChoices(args.choices));
      deps.store.setPendingQuestion(feature.id, body);

      try {
        await postPlannerQuestion(deps, feature, body);
        beginAgentIdle();
        const answer = await waitForQuestionAnswer(feature.id);
        deps.store.clearPendingQuestion(feature.id);
        return `The humans answered:\n${answer}`;
      } catch (error) {
        deps.store.clearPendingQuestion(feature.id);
        const message = error instanceof Error ? error.message : "Unknown Q&A error";
        return { content: [{ type: "text", text: message }], isError: true };
      } finally {
        endAgentIdle();
      }
    },
  };
}
