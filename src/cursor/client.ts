import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  Cursor,
  CursorAgentError,
  JsonlLocalAgentStore,
  type SDKAgent,
  type SDKCustomTool,
  type SendOptions,
} from "@cursor/sdk";
import type { Config } from "../config.js";
import { recordRunTokens, refreshPresence } from "../discord/presence.js";
import {
  isAgentCancelRequested,
  setActiveAgentRun,
} from "./activeRun.js";
import { beginLiveRunLog, persistRunLog, type AgentLogContext, type LiveRunLog } from "./agentLog.js";
import { activeRunDurationMs, resetAgentIdle, takeAgentIdleMs } from "./agentIdle.js";
import {
  beginAgentWatch,
  StuckAgentError,
  stuckErrorMessage,
  type AgentWatch,
} from "./agentWatch.js";

export function configureCursorSdk(config: Config): void {
  const storeDir = join(config.dataDir, "cursor-agents");
  mkdirSync(storeDir, { recursive: true });
  Cursor.configure({
    local: { store: new JsonlLocalAgentStore(storeDir) },
  });
}

export function localAgentOptions(
  config: Config,
  customTools?: Record<string, SDKCustomTool>,
) {
  return {
    apiKey: config.cursorApiKey,
    model: { id: config.cursorModel, params: config.cursorModelParams },
    local: {
      cwd: config.gameRepoDir,
      settingSources: [],
      ...(customTools ? { customTools } : {}),
    },
  };
}

function totalTokensOf(usage: { totalTokens?: number } | undefined): number | undefined {
  const n = usage?.totalTokens;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return n;
}

export async function sendAndWait(
  agent: SDKAgent,
  message: string,
  options?: SendOptions,
  log?: AgentLogContext,
): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string }> {
  resetAgentIdle();
  if (isAgentCancelRequested()) {
    return { status: "cancelled" };
  }
  const startedAt = Date.now();
  let run: Awaited<ReturnType<SDKAgent["send"]>> | undefined;
  let live: LiveRunLog | undefined;
  let streamDone: Promise<void> | undefined;
  let watch: AgentWatch | undefined;
  let outcome: { status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string } = {
    status: "error",
  };
  const activeMs = (): number => activeRunDurationMs(Date.now() - startedAt, takeAgentIdleMs());
  try {
    run = await agent.send(message, options);
    setActiveAgentRun(run);
    console.log(`cursor agentId=${agent.agentId} run.id=${run.id}`);
    const streaming = run;
    watch = beginAgentWatch({
      role: log?.role ?? "implementer",
      agentId: agent.agentId,
      runId: run.id,
      onGiveUp: async () => {
        if (streaming.supports("cancel")) {
          await streaming.cancel();
        }
      },
    });
    if (log) {
      live = beginLiveRunLog(log, agent, message, run.id);
      if (run.supports("stream")) {
        const writer = live;
        const activity = watch;
        streamDone = (async () => {
          try {
            for await (const event of streaming.stream()) {
              writer.applyEvent(event);
              activity.noteEvent(event);
            }
          } catch (error) {
            console.error("failed to stream agent log", error);
          }
        })();
      }
    } else if (run.supports("stream")) {
      const activity = watch;
      streamDone = (async () => {
        try {
          for await (const event of streaming.stream()) {
            activity.noteEvent(event);
          }
        } catch (error) {
          console.error("failed to stream agent log", error);
        }
      })();
    }
    if (isAgentCancelRequested() && run.supports("cancel")) {
      await run.cancel();
    }
    const result = await run.wait();
    if (watch?.activity().gaveUp) {
      const activity = watch.activity();
      const kind = activity.openToolName !== undefined ? "open_tool" : "silent";
      throw new StuckAgentError(stuckErrorMessage(activity, kind, Date.now()));
    }
    recordRunTokens(
      run.id,
      agent.agentId,
      totalTokensOf(result.usage) ?? totalTokensOf(run.usage),
      activeMs(),
    );
    if (result.status === "error") {
      console.error(`cursor run failed: ${result.id} ${result.error?.message ?? ""}`);
      outcome = {
        status: "error",
        result: result.result,
        errorMessage: result.error?.message ?? "run error",
      };
      return outcome;
    }
    outcome = { status: result.status, result: result.result };
    return outcome;
  } catch (error) {
    if (watch?.activity().gaveUp) {
      const activity = watch.activity();
      const kind = activity.openToolName !== undefined ? "open_tool" : "silent";
      const stuck = new StuckAgentError(stuckErrorMessage(activity, kind, Date.now()));
      if (run) {
        recordRunTokens(run.id, agent.agentId, totalTokensOf(run.usage), activeMs());
      }
      outcome = { status: "error", errorMessage: stuck.message };
      throw stuck;
    }
    if (run) {
      recordRunTokens(run.id, agent.agentId, totalTokensOf(run.usage), activeMs());
    }
    if (error instanceof CursorAgentError) {
      console.error(
        `cursor startup failed: ${error.message} retryable=${String(error.isRetryable)}`,
      );
    }
    outcome = {
      status: "error",
      errorMessage: error instanceof Error ? error.message : "run error",
    };
    throw error;
  } finally {
    watch?.stop();
    setActiveAgentRun(undefined);
    if (streamDone) {
      await streamDone;
    }
    if (live) {
      await live.finish(outcome, run);
    } else if (log) {
      await persistRunLog(log, agent, message, run, outcome);
    }
    await refreshPresence();
  }
}

export async function disposeAgent(agent: SDKAgent): Promise<void> {
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    agent.close();
  }
}
