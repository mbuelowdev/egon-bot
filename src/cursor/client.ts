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
import { refreshPresence } from "../discord/presence.js";

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

export async function sendAndWait(
  agent: SDKAgent,
  message: string,
  options?: SendOptions,
): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; errorMessage?: string }> {
  try {
    const run = await agent.send(message, options);
    console.log(`cursor agentId=${agent.agentId} run.id=${run.id}`);
    const result = await run.wait();
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
