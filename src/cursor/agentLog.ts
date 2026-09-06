import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, JsonlLocalAgentStore, type SDKAgent } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
import { featurePaths } from "./testReport.js";

export type AgentRole = "planner" | "implementer" | "tester";

export type AgentLogStep =
  | { type: "assistant"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; callId?: string; status?: string; args?: unknown; result?: unknown };

export type AgentLogEntry = {
  at: string;
  updatedAt?: string;
  role: AgentRole;
  agentId: string;
  runId: string;
  status: string;
  user: string;
  result?: string;
  errorMessage?: string;
  steps: AgentLogStep[];
};

export type AgentLogContext = {
  config: Config;
  featureId: number;
  role: AgentRole;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolName(message: unknown): string {
  const rec = asRecord(message);
  if (!rec) {
    return "tool";
  }
  if (typeof rec.type === "string" && rec.type !== "toolCall" && rec.type !== "tool_call") {
    return rec.type;
  }
  if (typeof rec.name === "string") {
    return rec.name;
  }
  return "tool";
}

function flattenSteps(steps: unknown): AgentLogStep[] {
  if (!Array.isArray(steps)) {
    return [];
  }
  const out: AgentLogStep[] = [];
  for (const step of steps) {
    const rec = asRecord(step);
    if (!rec) {
      continue;
    }
    if (rec.type === "assistantMessage") {
      const text = asString(asRecord(rec.message)?.text);
      if (text !== "") {
        out.push({ type: "assistant", text });
      }
      continue;
    }
    if (rec.type === "thinkingMessage") {
      const text = asString(asRecord(rec.message)?.text);
      if (text !== "") {
        out.push({ type: "thinking", text });
      }
      continue;
    }
    if (rec.type === "toolCall") {
      const message = rec.message;
      out.push({
        type: "tool",
        name: toolName(message),
        status: asString(asRecord(message)?.status) || undefined,
        args: asRecord(message)?.args,
        result: asRecord(message)?.result,
      });
    }
  }
  return out;
}

/** Pull user prompt + assistant/tool/thinking steps out of SDK conversation turns. */
export function flattenConversation(turns: unknown, fallbackUser: string): {
  user: string;
  steps: AgentLogStep[];
} {
  let user = fallbackUser;
  const steps: AgentLogStep[] = [];
  if (!Array.isArray(turns)) {
    return { user, steps };
  }
  for (const turn of turns) {
    const rec = asRecord(turn);
    if (!rec) {
      continue;
    }
    if (rec.type === "agentConversationTurn") {
      const inner = asRecord(rec.turn);
      const prompt = asString(asRecord(inner?.userMessage)?.text);
      if (prompt !== "") {
        user = prompt;
      }
      steps.push(...flattenSteps(inner?.steps));
      continue;
    }
    if (rec.type === "shellConversationTurn") {
      const inner = asRecord(rec.turn);
      const command = asRecord(inner?.shellCommand);
      const output = asRecord(inner?.shellOutput);
      steps.push({
        type: "tool",
        name: "shell",
        args: command,
        result: output,
      });
    }
  }
  return { user, steps };
}

export function readAgentLog(dataDir: string, featureId: number): AgentLogEntry[] {
  const path = featurePaths(dataDir, featureId).agentLogPath;
  if (!existsSync(path)) {
    return [];
  }
  const entries: AgentLogEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    try {
      entries.push(JSON.parse(line) as AgentLogEntry);
    } catch {
      // skip corrupt lines
    }
  }
  return entries;
}

function writeAgentLogFile(dataDir: string, featureId: number, entries: AgentLogEntry[]): void {
  const paths = featurePaths(dataDir, featureId);
  mkdirSync(paths.root, { recursive: true });
  const tmp = `${paths.agentLogPath}.${String(process.pid)}.tmp`;
  const body =
    entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, paths.agentLogPath);
}

/** Insert or replace the run with the same `runId` so in-flight updates do not duplicate. */
export function upsertAgentLog(dataDir: string, featureId: number, entry: AgentLogEntry): void {
  const entries = readAgentLog(dataDir, featureId);
  const idx = entry.runId === "" ? -1 : entries.findIndex((item) => item.runId === entry.runId);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  writeAgentLogFile(dataDir, featureId, entries);
}

export function appendAgentLog(dataDir: string, featureId: number, entry: AgentLogEntry): void {
  upsertAgentLog(dataDir, featureId, entry);
}

function appendTextStep(
  entry: AgentLogEntry,
  type: "assistant" | "thinking",
  text: string,
): void {
  if (text === "") {
    return;
  }
  const last = entry.steps.at(-1);
  if (last?.type === type) {
    last.text = text.startsWith(last.text) ? text : `${last.text}${text}`;
    return;
  }
  entry.steps.push({ type, text });
}

/** Fold one `run.stream()` event into the in-progress log entry. */
export function applyStreamEvent(entry: AgentLogEntry, event: unknown): void {
  const rec = asRecord(event);
  if (!rec || typeof rec.type !== "string") {
    return;
  }
  if (rec.type === "user") {
    const text = messageText(rec.message);
    if (text !== "") {
      entry.user = text;
    }
    return;
  }
  if (rec.type === "assistant") {
    appendTextStep(entry, "assistant", messageText(rec.message));
    const last = entry.steps.findLast((step) => step.type === "assistant");
    if (last?.type === "assistant") {
      entry.result = last.text;
    }
    return;
  }
  if (rec.type === "thinking") {
    appendTextStep(entry, "thinking", asString(rec.text));
    return;
  }
  if (rec.type !== "tool_call") {
    return;
  }
  const callId = asString(rec.call_id) || undefined;
  const name = asString(rec.name) || "tool";
  const existing =
    callId === undefined
      ? undefined
      : entry.steps.findLast((step) => step.type === "tool" && step.callId === callId);
  if (existing?.type === "tool") {
    existing.name = name;
    existing.status = asString(rec.status) || existing.status;
    if (rec.args !== undefined) {
      existing.args = rec.args;
    }
    if (rec.result !== undefined) {
      existing.result = rec.result;
    }
    return;
  }
  entry.steps.push({
    type: "tool",
    name,
    callId,
    status: asString(rec.status) || undefined,
    args: rec.args,
    result: rec.result,
  });
}

function messageText(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  const rec = asRecord(message);
  if (!rec) {
    return "";
  }
  if (typeof rec.text === "string") {
    return rec.text;
  }
  if (Array.isArray(rec.content)) {
    return rec.content
      .map((block) => {
        const item = asRecord(block);
        return item && typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }
  if (rec.message !== undefined) {
    return messageText(rec.message);
  }
  return "";
}

async function hydrateAgent(
  config: Config,
  agentId: string,
  role: AgentRole,
): Promise<AgentLogEntry[]> {
  const store = new JsonlLocalAgentStore(join(config.dataDir, "cursor-agents"));
  const listOptions = {
    runtime: "local" as const,
    cwd: config.gameRepoDir,
    store,
  };
  try {
    const entries: AgentLogEntry[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await Agent.listRuns(agentId, { ...listOptions, cursor, limit: 100 });
      for (const run of page.items) {
        let user = "";
        let steps: AgentLogStep[] = [];
        if (run.supports("conversation")) {
          try {
            const flat = flattenConversation(await run.conversation(), "");
            user = flat.user;
            steps = flat.steps;
          } catch {
            // conversation() is best-effort for old runs
          }
        }
        if (steps.length === 0 && typeof run.result === "string" && run.result !== "") {
          steps.push({ type: "assistant", text: run.result });
        }
        entries.push({
          at:
            typeof run.createdAt === "number"
              ? new Date(run.createdAt).toISOString()
              : new Date().toISOString(),
          role,
          agentId,
          runId: run.id,
          status: run.status,
          user,
          result: run.result,
          errorMessage: run.error?.message,
          steps,
        });
      }
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }
    if (entries.length > 0) {
      return entries;
    }
  } catch {
    // fall through to message list
  }
  try {
    const messages = await Agent.messages.list(agentId, listOptions);
    const entries: AgentLogEntry[] = [];
    let current: AgentLogEntry | undefined;
    for (const msg of messages) {
      const text = messageText(msg.message);
      if (msg.type === "user") {
        if (current) {
          entries.push(current);
        }
        current = {
          at: new Date().toISOString(),
          role,
          agentId,
          runId: msg.uuid,
          status: "finished",
          user: text,
          steps: [],
        };
      } else if (msg.type === "assistant" && text !== "") {
        if (!current) {
          current = {
            at: new Date().toISOString(),
            role,
            agentId,
            runId: msg.uuid,
            status: "finished",
            user: "",
            steps: [],
          };
        }
        current.steps.push({ type: "assistant", text });
        current.result = text;
      }
    }
    if (current) {
      entries.push(current);
    }
    return entries;
  } catch {
    return [];
  }
}

async function hydrateFromSdk(config: Config, feature: Feature): Promise<AgentLogEntry[]> {
  const jobs: Array<Promise<AgentLogEntry[]>> = [];
  if (feature.plannerAgentId) {
    jobs.push(hydrateAgent(config, feature.plannerAgentId, "planner"));
  }
  if (feature.implementerAgentId) {
    jobs.push(hydrateAgent(config, feature.implementerAgentId, "implementer"));
  }
  const groups = await Promise.all(jobs);
  return groups.flat();
}

export async function loadFeatureAgentLog(config: Config, feature: Feature): Promise<AgentLogEntry[]> {
  const existing = readAgentLog(config.dataDir, feature.id);
  if (existing.length > 0) {
    return existing;
  }
  try {
    const hydrated = await hydrateFromSdk(config, feature);
    for (const entry of hydrated) {
      appendAgentLog(config.dataDir, feature.id, entry);
    }
    return hydrated;
  } catch (error) {
    console.error("failed to hydrate agent log", error);
    return [];
  }
}

type ConversationRun = {
  id: string;
  supports: (op: "conversation") => boolean;
  conversation: () => Promise<unknown>;
};

export async function persistRunLog(
  log: AgentLogContext,
  agent: SDKAgent,
  userMessage: string,
  run: ConversationRun | undefined,
  outcome: { status: string; result?: string; errorMessage?: string },
  existing?: AgentLogEntry,
): Promise<void> {
  try {
    const entry: AgentLogEntry = existing ?? {
      at: new Date().toISOString(),
      role: log.role,
      agentId: agent.agentId,
      runId: run?.id ?? "",
      status: "running",
      user: userMessage,
      steps: [],
    };
    let user = entry.user !== "" ? entry.user : userMessage;
    let steps = entry.steps;
    if (run?.supports("conversation")) {
      try {
        const flat = flattenConversation(await run.conversation(), user);
        if (flat.user !== "") {
          user = flat.user;
        }
        if (flat.steps.length > 0) {
          steps = flat.steps;
        }
      } catch (error) {
        console.error("failed to read run conversation", error);
      }
    }
    if (steps.length === 0 && outcome.result) {
      steps = [{ type: "assistant", text: outcome.result }];
    }
    upsertAgentLog(log.config.dataDir, log.featureId, {
      ...entry,
      runId: run?.id ?? entry.runId,
      status: outcome.status,
      user,
      result: outcome.result ?? entry.result,
      errorMessage: outcome.errorMessage,
      steps,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("failed to persist agent log", error);
  }
}

const LIVE_FLUSH_MS = 400;

export type LiveRunLog = {
  applyEvent: (event: unknown) => void;
  finish: (
    outcome: { status: string; result?: string; errorMessage?: string },
    run: ConversationRun | undefined,
  ) => Promise<void>;
};

/** Write the prompt immediately, then fold stream events so a catalog refresh sees in-flight output. */
export function beginLiveRunLog(
  log: AgentLogContext,
  agent: SDKAgent,
  userMessage: string,
  runId: string,
): LiveRunLog {
  const started = new Date().toISOString();
  const entry: AgentLogEntry = {
    at: started,
    updatedAt: started,
    role: log.role,
    agentId: agent.agentId,
    runId,
    status: "running",
    user: userMessage,
    steps: [],
  };
  upsertAgentLog(log.config.dataDir, log.featureId, entry);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    entry.updatedAt = new Date().toISOString();
    upsertAgentLog(log.config.dataDir, log.featureId, entry);
  };
  const schedule = (immediate: boolean): void => {
    if (immediate) {
      flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(flush, LIVE_FLUSH_MS);
    }
  };
  return {
    applyEvent(event) {
      const rec = asRecord(event);
      applyStreamEvent(entry, event);
      schedule(rec?.type === "tool_call" || rec?.type === "status");
    },
    async finish(outcome, run) {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await persistRunLog(log, agent, entry.user, run, outcome, entry);
    },
  };
}
