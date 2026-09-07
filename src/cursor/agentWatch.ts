import { formatDuration } from "../format.js";
import { isAgentIdle } from "./agentIdle.js";
import type { AgentLogEntry, AgentLogStep, AgentRole } from "./agentLog.js";

/** Heartbeat to docker logs while a run is silent. */
export const AGENT_HEARTBEAT_MS = 60_000;
/** Open tool call with no stream events. Typical Playwright/MCP hang. */
export const AGENT_STUCK_TOOL_MS = 3 * 60_000;
/** No stream events at all (including thinking). */
export const AGENT_STUCK_SILENT_MS = 10 * 60_000;
/** Fable xhigh thinking can stay quiet longer than implementer/tester runs. */
export const PLANNER_STUCK_SILENT_MS = 30 * 60_000;
/** Cancel a silent run so the pipeline is not blocked forever. */
export const AGENT_STUCK_CANCEL_MS = 60 * 60_000;
export const AGENT_WATCH_INTERVAL_MS = 15_000;

export type StuckKind = "open_tool" | "silent";

export type AgentActivity = {
  role: AgentRole;
  agentId: string;
  runId: string;
  startedAt: number;
  lastEventAt: number;
  lastHeartbeatAt: number;
  lastSummary: string;
  openToolName?: string;
  openToolAt?: number;
  stuckNotified: boolean;
  gaveUp: boolean;
};

export class StuckAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StuckAgentError";
  }
}

const OPEN_TOOL_STATUSES = new Set(["", "running", "in_progress", "started", "pending"]);
const CLOSED_TOOL_STATUSES = new Set([
  "completed",
  "complete",
  "error",
  "failed",
  "cancelled",
  "canceled",
  "success",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isOpenToolStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  if (CLOSED_TOOL_STATUSES.has(normalized)) {
    return false;
  }
  return OPEN_TOOL_STATUSES.has(normalized);
}

function mcpToolName(args: Record<string, unknown> | undefined): string {
  if (!args) {
    return "";
  }
  for (const key of ["toolName", "tool_name", "name", "tool"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

export function toolEventLabel(rec: Record<string, unknown>): string {
  const args = asRecord(rec.args);
  const name = asString(rec.name) || "tool";
  const mcp = mcpToolName(args);
  if (mcp !== "" && mcp !== name) {
    return `${name} ${mcp}`;
  }
  return name;
}

export function summarizeStreamEvent(event: unknown): string | undefined {
  const rec = asRecord(event);
  if (!rec || typeof rec.type !== "string") {
    return undefined;
  }
  if (rec.type === "tool_call") {
    const status = asString(rec.status) || "running";
    return `tool ${toolEventLabel(rec)} ${status}`;
  }
  if (rec.type === "thinking") {
    return "thinking";
  }
  if (rec.type === "assistant") {
    return "assistant";
  }
  if (rec.type === "status") {
    const status = asString(rec.status) || asString(rec.message);
    return status !== "" ? `status ${status}` : "status";
  }
  return rec.type;
}

export function applyActivityEvent(activity: AgentActivity, event: unknown, now: number): void {
  const rec = asRecord(event);
  const summary = summarizeStreamEvent(event);
  activity.lastEventAt = now;
  if (summary) {
    activity.lastSummary = summary;
  }
  if (!activity.gaveUp) {
    activity.stuckNotified = false;
  }
  if (rec?.type !== "tool_call") {
    return;
  }
  const name = toolEventLabel(rec);
  const status = asString(rec.status);
  if (!isOpenToolStatus(status) || rec.result !== undefined) {
    if (activity.openToolName !== undefined) {
      activity.openToolName = undefined;
      activity.openToolAt = undefined;
    }
    return;
  }
  activity.openToolName = name;
  activity.openToolAt = now;
}

export function hangingToolName(steps: AgentLogStep[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step?.type !== "tool") {
      continue;
    }
    if (isOpenToolStatus(step.status) && step.result === undefined) {
      return step.name;
    }
    return undefined;
  }
  return undefined;
}

export function stuckKind(
  input: {
    lastEventAt: number;
    openToolName?: string;
    openToolAt?: number;
    role?: AgentRole;
  },
  now: number,
): StuckKind | undefined {
  if (isAgentIdle()) {
    return undefined;
  }
  if (input.openToolName !== undefined) {
    const started = input.openToolAt ?? input.lastEventAt;
    if (now - started >= AGENT_STUCK_TOOL_MS) {
      return "open_tool";
    }
  }
  const silentMs = input.role === "planner" ? PLANNER_STUCK_SILENT_MS : AGENT_STUCK_SILENT_MS;
  if (now - input.lastEventAt >= silentMs) {
    return "silent";
  }
  return undefined;
}

export function shouldCancelStuck(
  input: {
    lastEventAt: number;
    openToolName?: string;
    openToolAt?: number;
  },
  now: number,
): boolean {
  if (isAgentIdle()) {
    return false;
  }
  const started =
    input.openToolName !== undefined ? (input.openToolAt ?? input.lastEventAt) : input.lastEventAt;
  return now - started >= AGENT_STUCK_CANCEL_MS;
}

export function logEntryStuckKind(entry: AgentLogEntry, now: number): StuckKind | undefined {
  if (entry.status !== "running") {
    return undefined;
  }
  const last = Date.parse(entry.updatedAt ?? entry.at);
  const lastEventAt = Number.isFinite(last) ? last : now;
  return stuckKind(
    {
      lastEventAt,
      openToolName: hangingToolName(entry.steps),
      openToolAt: lastEventAt,
      role: entry.role,
    },
    now,
  );
}

export function roleLabel(role: AgentRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function formatStatusActivity(activity: AgentActivity, now: number = Date.now()): string {
  if (isAgentIdle()) {
    return `${roleLabel(activity.role)} waiting for a Discord answer.`;
  }
  const ago = formatDuration(Math.max(0, now - activity.lastEventAt));
  const bits = [
    `${roleLabel(activity.role)} ${activity.runId}`,
    `last activity ${ago} ago`,
    activity.lastSummary,
  ];
  if (stuckKind(activity, now)) {
    bits.push("possibly stuck");
    return `${bits.join(" · ")}. Use /egon-retry to cancel and continue.`;
  }
  return `${bits.join(" · ")}.`;
}

export function stuckErrorMessage(activity: AgentActivity, kind: StuckKind, now: number): string {
  const since =
    kind === "open_tool"
      ? now - (activity.openToolAt ?? activity.lastEventAt)
      : now - activity.lastEventAt;
  const tool = activity.openToolName ? ` while ${activity.openToolName} was running` : "";
  return `${roleLabel(activity.role)} appeared stuck (${formatDuration(since)} with no stream events${tool}).`;
}

let currentActivity: AgentActivity | undefined;

export function getActiveAgentActivity(): AgentActivity | undefined {
  return currentActivity;
}

export type AgentWatch = {
  noteEvent: (event: unknown) => void;
  stop: () => void;
  activity: () => AgentActivity;
};

export function beginAgentWatch(options: {
  role: AgentRole;
  agentId: string;
  runId: string;
  now?: () => number;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  log?: (line: string) => void;
  onStuck?: (activity: AgentActivity, kind: StuckKind) => void | Promise<void>;
  onGiveUp?: (activity: AgentActivity, kind: StuckKind) => void | Promise<void>;
}): AgentWatch {
  const now = options.now ?? Date.now;
  const log = options.log ?? console.log;
  const startedAt = now();
  const activity: AgentActivity = {
    role: options.role,
    agentId: options.agentId,
    runId: options.runId,
    startedAt,
    lastEventAt: startedAt,
    lastHeartbeatAt: startedAt,
    lastSummary: "run started",
    stuckNotified: false,
    gaveUp: false,
  };
  currentActivity = activity;

  const tick = (): void => {
    const t = now();
    if (isAgentIdle() || activity.gaveUp) {
      return;
    }
    const silence = t - activity.lastEventAt;
    if (silence >= AGENT_HEARTBEAT_MS && t - activity.lastHeartbeatAt >= AGENT_HEARTBEAT_MS) {
      activity.lastHeartbeatAt = t;
      log(
        `cursor ${activity.role} waiting ${formatDuration(silence)} last=${activity.lastSummary}`,
      );
    }
    const kind = stuckKind(activity, t);
    if (!kind) {
      return;
    }
    if (!activity.stuckNotified) {
      activity.stuckNotified = true;
      console.warn(
        `cursor ${activity.role} appears stuck: ${stuckErrorMessage(activity, kind, t)}`,
      );
      void Promise.resolve(options.onStuck?.(activity, kind)).catch((error: unknown) => {
        console.error("failed to notify stuck agent", error);
      });
    }
    if (!shouldCancelStuck(activity, t)) {
      return;
    }
    activity.gaveUp = true;
    console.error(
      `cursor ${activity.role} stuck too long; cancelling ${activity.runId}`,
    );
    void Promise.resolve(options.onGiveUp?.(activity, kind)).catch((error: unknown) => {
      console.error("failed to cancel stuck agent", error);
    });
  };

  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const timer = setIntervalFn(tick, options.intervalMs ?? AGENT_WATCH_INTERVAL_MS);

  return {
    noteEvent(event) {
      const rec = asRecord(event);
      applyActivityEvent(activity, event, now());
      if (rec?.type === "tool_call") {
        log(`cursor ${activity.role} ${activity.lastSummary}`);
      }
    },
    stop() {
      clearIntervalFn(timer);
      if (currentActivity === activity) {
        currentActivity = undefined;
      }
    },
    activity: () => activity,
  };
}
