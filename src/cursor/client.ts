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
import { activeRunDurationMs, resetAgentIdle, takeAgentIdleMs } from "./agentIdle.js";

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
): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string }> {
  resetAgentIdle();
  const startedAt = Date.now();
  let run: Awaited<ReturnType<SDKAgent["send"]>> | undefined;
  const activeMs = (): number => activeRunDurationMs(Date.now() - startedAt, takeAgentIdleMs());
  try {
    run = await agent.send(message, options);
    console.log(`cursor agentId=${agent.agentId} run.id=${run.id}`);
    const result = await run.wait();
    recordRunTokens(
      run.id,
      agent.agentId,
      totalTokensOf(result.usage) ?? totalTokensOf(run.usage),
      activeMs(),
    );
    if (result.status === "error") {
      console.error(`cursor run failed: ${result.id} ${result.error?.message ?? ""}`);
      return {
        status: "error",
        result: result.result,
        errorMessage: result.error?.message ?? "run error",
      };
    }
    return { status: result.status, result: result.result };
  } catch (error) {
    if (run) {
      recordRunTokens(run.id, agent.agentId, totalTokensOf(run.usage), activeMs());
    }
    if (error instanceof CursorAgentError) {
      console.error(
        `cursor startup failed: ${error.message} retryable=${String(error.isRetryable)}`,
      );
    }
    throw error;
  } finally {
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
