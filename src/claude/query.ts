import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SDKImage } from "@cursor/sdk";
import type { Config } from "../config.js";
import { ASK_DISCORD_MCP_TIMEOUT_MS } from "../discord/qaWaiters.js";
import { refreshPresence } from "../discord/presence.js";
import {
  isAgentCancelRequested,
  setActiveAgentRun,
} from "../cursor/activeRun.js";
import { beginLiveRunLog, type AgentLogContext } from "../cursor/agentLog.js";
import { activeRunDurationMs, resetAgentIdle, takeAgentIdleMs } from "../cursor/agentIdle.js";
import {
  beginAgentWatch,
  StuckAgentError,
  stuckErrorMessage,
} from "../cursor/agentWatch.js";
import { ASK_DISCORD_MCP_TOOL, createPlannerMcpServer } from "./askUsersTool.js";
import { plannerCanUseTool } from "./permissions.js";
import {
  claudeAssistantError,
  claudeMessageToWatchEvents,
  claudeQueryProducedWork,
  claudeResultCostUsd,
  claudeResultIsError,
  claudeResultText,
  claudeSessionId,
} from "./stream.js";
import { ClaudeUsageLimitError, looksLikeClaudeUsageLimit } from "./usageLimit.js";
import type { AskUsersDeps } from "../cursor/askQuestions.js";

export const CLAUDE_PLANNER_MODEL = "claude-opus-5";
export const CLAUDE_PLANNER_EFFORT = "high" as const;
const API_TIMEOUT_MS = "600000";

export type ClaudeQueryOutcome = {
  status: "finished" | "error" | "cancelled";
  result?: string;
  errorMessage?: string;
  sessionId: string;
  started: boolean;
  costUsd?: number;
};

export function envForClaude(config: Config): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_CODE_OAUTH_TOKEN: config.claudeCodeOAuthToken,
    CLAUDE_CONFIG_DIR: join(config.dataDir, "claude"),
    API_TIMEOUT_MS,
    MCP_TOOL_TIMEOUT: String(ASK_DISCORD_MCP_TIMEOUT_MS),
    CLAUDE_AGENT_SDK_CLIENT_APP: "egon-bot/planner",
  };
  // API key / bearer token outrank CLAUDE_CODE_OAUTH_TOKEN in the Agent SDK.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function inlineImage(
  image: SDKImage,
): { media: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } | undefined {
  if (!("data" in image) || typeof image.data !== "string") {
    return undefined;
  }
  const mimeType = "mimeType" in image && typeof image.mimeType === "string" ? image.mimeType : "";
  if (!CLAUDE_IMAGE_TYPES.has(mimeType)) {
    return undefined;
  }
  return { media: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: image.data };
}

export function buildClaudeUserPrompt(
  text: string,
  images: SDKImage[],
): string | AsyncIterable<SDKUserMessage> {
  if (images.length === 0) {
    return text;
  }
  const content: SDKUserMessage["message"]["content"] = [{ type: "text", text }];
  for (const image of images) {
    const inline = inlineImage(image);
    if (!inline) {
      continue;
    }
    content.push({
      type: "image",
      source: { type: "base64", media_type: inline.media, data: inline.data },
    });
  }
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content },
  };
  return (async function* yieldOnce() {
    yield message;
  })();
}

export async function queryPlanner(options: {
  config: Config;
  deps: AskUsersDeps;
  /** Every path the planner may write: the spec and its checks file. */
  specPath: string | string[];
  systemPrompt: string;
  prompt: string | AsyncIterable<SDKUserMessage>;
  resume?: string;
  logText: string;
  onSession: (sessionId: string) => void;
}): Promise<ClaudeQueryOutcome> {
  resetAgentIdle();
  if (isAgentCancelRequested()) {
    return { status: "cancelled", sessionId: options.resume ?? "", started: false };
  }
  mkdirSync(join(options.config.dataDir, "claude"), { recursive: true });
  const abortController = new AbortController();
  const mcp = createPlannerMcpServer(options.deps);
  const queryOptions: Options = {
    abortController,
    cwd: options.config.gameRepoDir,
    model: CLAUDE_PLANNER_MODEL,
    effort: CLAUDE_PLANNER_EFFORT,
    thinking: { type: "adaptive", display: "summarized" },
    settingSources: [],
    strictMcpConfig: true,
    persistSession: true,
    permissionMode: "acceptEdits",
    tools: ["Read", "Glob", "Grep", "Write", "Edit"],
    mcpServers: { egon: mcp },
    allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", ASK_DISCORD_MCP_TOOL],
    disallowedTools: ["Bash", "Agent", "WebSearch", "WebFetch"],
    systemPrompt: { type: "custom", prompt: options.systemPrompt, snapshot: true },
    env: envForClaude(options.config),
    canUseTool: async (toolName, input) => plannerCanUseTool(options.specPath, toolName, input),
    ...(options.resume ? { resume: options.resume } : {}),
  };
  const startedAt = Date.now();
  let sessionId = options.resume ?? "";
  let started = false;
  let resultText: string | undefined;
  let costUsd: number | undefined;
  let outcome: ClaudeQueryOutcome = {
    status: "error",
    sessionId,
    started: false,
  };
  const q = query({ prompt: options.prompt, options: queryOptions });
  setActiveAgentRun({
    supports: (operation) => operation === "cancel",
    cancel: async () => {
      abortController.abort();
      q.close();
    },
  });
  const log: AgentLogContext = {
    config: options.config,
    featureId: options.deps.featureId,
    role: "planner",
  };
  const runId = sessionId !== "" ? sessionId : "claude-planner";
  const live = beginLiveRunLog(log, { agentId: sessionId || "claude-pending" }, options.logText, runId);
  const watch = beginAgentWatch({
    role: "planner",
    agentId: sessionId || "claude-pending",
    runId,
    onGiveUp: async () => {
      abortController.abort();
      q.close();
    },
  });
  const persistSession = (id: string | undefined): void => {
    if (!id) {
      return;
    }
    if (id !== sessionId) {
      sessionId = id;
      options.onSession(id);
      return;
    }
    sessionId = id;
  };
  try {
    if (isAgentCancelRequested()) {
      abortController.abort();
      q.close();
    }
    for await (const message of q) {
      const rec = message as { type?: string };
      const assistantError = claudeAssistantError(message);
      if (assistantError && looksLikeClaudeUsageLimit({ error: assistantError, message })) {
        throw new ClaudeUsageLimitError(`Claude ${assistantError}`, started);
      }
      if (rec.type === "rate_limit_event") {
        const info = (message as { rate_limit_info?: { status?: string } }).rate_limit_info;
        if (looksLikeClaudeUsageLimit({ rateLimitStatus: info?.status, rate_limit_info: info })) {
          throw new ClaudeUsageLimitError("Claude rate limit rejected", started);
        }
      }
      persistSession(claudeSessionId(message));
      if (claudeQueryProducedWork(message)) {
        started = true;
      }
      for (const event of claudeMessageToWatchEvents(message)) {
        watch.noteEvent(event);
        live.applyEvent(event);
      }
      if (rec.type === "result") {
        resultText = claudeResultText(message);
        costUsd = claudeResultCostUsd(message);
        if (costUsd !== undefined) {
          console.log(`claude planner session=${sessionId} total_cost_usd=${String(costUsd)}`);
        }
        if (claudeResultIsError(message) && looksLikeClaudeUsageLimit(message)) {
          throw new ClaudeUsageLimitError(resultText ?? "Claude usage limit", started);
        }
        if (claudeResultIsError(message)) {
          outcome = {
            status: "error",
            result: resultText,
            errorMessage: resultText ?? "run error",
            sessionId,
            started,
            costUsd,
          };
        } else {
          outcome = {
            status: "finished",
            result: resultText,
            sessionId,
            started,
            costUsd,
          };
        }
      }
    }
    if (watch.activity().gaveUp) {
      const activity = watch.activity();
      const kind = activity.openToolName !== undefined ? "open_tool" : "silent";
      throw new StuckAgentError(stuckErrorMessage(activity, kind, Date.now()));
    }
    if (isAgentCancelRequested() || abortController.signal.aborted) {
      outcome = { status: "cancelled", result: resultText, sessionId, started, costUsd };
    }
    return outcome;
  } catch (error) {
    if (watch.activity().gaveUp) {
      const activity = watch.activity();
      const kind = activity.openToolName !== undefined ? "open_tool" : "silent";
      const stuck = new StuckAgentError(stuckErrorMessage(activity, kind, Date.now()));
      outcome = { status: "error", errorMessage: stuck.message, sessionId, started, costUsd };
      throw stuck;
    }
    if (looksLikeClaudeUsageLimit(error) || error instanceof ClaudeUsageLimitError) {
      const message = error instanceof Error ? error.message : "Claude usage limit";
      throw new ClaudeUsageLimitError(message, error instanceof ClaudeUsageLimitError ? error.started : started);
    }
    outcome = {
      status: "error",
      errorMessage: error instanceof Error ? error.message : "run error",
      sessionId,
      started,
      costUsd,
    };
    throw error;
  } finally {
    watch.stop();
    setActiveAgentRun(undefined);
    await live.finish(outcome, undefined);
    void activeRunDurationMs(Date.now() - startedAt, takeAgentIdleMs());
    await refreshPresence();
  }
}
