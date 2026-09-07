import type { SDKCustomTool } from "@cursor/sdk";
import {
  ASK_TOOL_DESCRIPTION,
  MAX_ASK_QUESTIONS,
  askDiscordQuestionRound,
  parsePlannerQuestions,
  type AskUsersDeps,
} from "./askQuestions.js";

export type { AskUsersDeps } from "./askQuestions.js";
export { postPlannerQuestion } from "./askQuestions.js";

export function createAskDiscordUsersTool(deps: AskUsersDeps): SDKCustomTool {
  return {
    description: ASK_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ASK_QUESTIONS,
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The question to post in Discord.",
              },
              default: {
                type: "string",
                description: "Value to use if Discord does not answer this question.",
              },
              choices: {
                type: "array",
                items: { type: "string" },
                maxItems: 3,
                description: "Up to 3 answer options. Humans can also pick Answer other.",
              },
              topic: {
                type: "string",
                enum: ["art-style", "camera", "control-scheme", "palette"],
                description:
                  "Set for game-wide choices so the answer is recorded in GAME_DECISIONS and not re-asked later.",
              },
            },
            required: ["question", "default"],
          },
          description: "Every independent question for this round. Discord asks them sequentially.",
        },
      },
      required: ["questions"],
    },
    annotations: {
      title: "Ask Discord users",
      openWorldHint: true,
    },
    async execute(args) {
      const parsed = parsePlannerQuestions(args);
      if ("error" in parsed) {
        return { content: [{ type: "text", text: parsed.error }], isError: true };
      }
      try {
        const text = await askDiscordQuestionRound(deps, parsed);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown Q&A error";
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  };
}
