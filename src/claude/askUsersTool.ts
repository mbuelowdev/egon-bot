import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ASK_DISCORD_MCP_TIMEOUT_MS } from "../discord/qaWaiters.js";
import {
  ASK_TOOL_DESCRIPTION,
  MAX_ASK_QUESTIONS,
  askDiscordQuestionRound,
  parsePlannerQuestions,
  type AskUsersDeps,
} from "../cursor/askQuestions.js";

export const ASK_DISCORD_MCP_TOOL = "mcp__egon__ask_discord_users";

export function createPlannerMcpServer(deps: AskUsersDeps) {
  const askDiscordUsers = tool(
    "ask_discord_users",
    ASK_TOOL_DESCRIPTION,
    {
      questions: z
        .array(
          z.object({
            question: z.string().describe("The question to post in Discord."),
            default: z.string().describe("Value to use if Discord does not answer this question."),
            choices: z
              .array(z.string())
              .max(3)
              .optional()
              .describe("Up to 3 answer options. Humans can also pick Answer other."),
            topic: z
              .enum(["art-style", "camera", "control-scheme", "palette"])
              .optional()
              .describe(
                "Set for game-wide choices so the answer is recorded in GAME_DECISIONS and not re-asked later.",
              ),
          }),
        )
        .min(1)
        .max(MAX_ASK_QUESTIONS)
        .describe("Every independent question for this round. Discord asks them sequentially."),
    },
    async (args) => {
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
  );
  return createSdkMcpServer({
    name: "egon",
    version: "1.0.0",
    tools: [askDiscordUsers],
    timeout: ASK_DISCORD_MCP_TIMEOUT_MS,
  });
}
