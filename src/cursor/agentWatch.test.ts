import assert from "node:assert/strict";
import { test } from "node:test";
import { beginAgentIdle, endAgentIdle, resetAgentIdle } from "./agentIdle.js";
import {
  AGENT_STUCK_CANCEL_MS,
  AGENT_STUCK_SILENT_MS,
  AGENT_STUCK_TOOL_MS,
  PLANNER_STUCK_SILENT_MS,
  applyActivityEvent,
  beginAgentWatch,
  formatStatusActivity,
  hangingToolName,
  logEntryStuckKind,
  shouldCancelStuck,
  stuckKind,
  summarizeStreamEvent,
  type AgentActivity,
} from "./agentWatch.js";
import type { AgentLogEntry } from "./agentLog.js";

function activity(overrides: Partial<AgentActivity> = {}): AgentActivity {
  return {
    role: "tester",
    agentId: "a1",
    runId: "r1",
    startedAt: 0,
    lastEventAt: 0,
    lastHeartbeatAt: 0,
    lastSummary: "run started",
    stuckNotified: false,
    gaveUp: false,
    ...overrides,
  };
}

test("summarizeStreamEvent prefers the MCP tool name", () => {
  assert.equal(
    summarizeStreamEvent({
      type: "tool_call",
      name: "CallMcpTool",
      status: "running",
      args: { toolName: "browser_navigate", url: "http://127.0.0.1:8080/" },
    }),
    "tool CallMcpTool browser_navigate running",
  );
  assert.equal(summarizeStreamEvent({ type: "thinking", text: "hmm" }), "thinking");
});

test("applyActivityEvent tracks an open tool and clears it on completion", () => {
  const current = activity();
  applyActivityEvent(
    current,
    { type: "tool_call", name: "browser_navigate", status: "running" },
    1_000,
  );
  assert.equal(current.openToolName, "browser_navigate");
  assert.equal(current.openToolAt, 1_000);
  assert.equal(current.lastSummary, "tool browser_navigate running");
  applyActivityEvent(
    current,
    { type: "tool_call", name: "browser_navigate", status: "completed", result: { ok: true } },
    2_000,
  );
  assert.equal(current.openToolName, undefined);
  assert.equal(current.lastSummary, "tool browser_navigate completed");
});

test("stuckKind flags a hanging tool before total silence", () => {
  const hanging = activity({
    lastEventAt: 0,
    openToolName: "browser_navigate",
    openToolAt: 0,
  });
  assert.equal(stuckKind(hanging, AGENT_STUCK_TOOL_MS - 1), undefined);
  assert.equal(stuckKind(hanging, AGENT_STUCK_TOOL_MS), "open_tool");
  const silent = activity({ lastEventAt: 0 });
  assert.equal(stuckKind(silent, AGENT_STUCK_SILENT_MS - 1), undefined);
  assert.equal(stuckKind(silent, AGENT_STUCK_SILENT_MS), "silent");
});

test("stuckKind gives the planner a longer silent threshold", () => {
  const planner = activity({ role: "planner", lastEventAt: 0 });
  assert.equal(stuckKind(planner, AGENT_STUCK_SILENT_MS), undefined);
  assert.equal(stuckKind(planner, PLANNER_STUCK_SILENT_MS - 1), undefined);
  assert.equal(stuckKind(planner, PLANNER_STUCK_SILENT_MS), "silent");
});

test("stuckKind ignores Discord Q&A idle waits", () => {
  resetAgentIdle();
  beginAgentIdle();
  try {
    assert.equal(
      stuckKind(
        { lastEventAt: 0, openToolName: "ask_discord_users", openToolAt: 0 },
        AGENT_STUCK_CANCEL_MS,
      ),
      undefined,
    );
  } finally {
    endAgentIdle();
    resetAgentIdle();
  }
});

test("shouldCancelStuck waits 60 minutes", () => {
  const hanging = activity({
    lastEventAt: 0,
    openToolName: "browser_navigate",
    openToolAt: 0,
  });
  assert.equal(shouldCancelStuck(hanging, AGENT_STUCK_TOOL_MS), false);
  assert.equal(shouldCancelStuck(hanging, AGENT_STUCK_CANCEL_MS - 1), false);
  assert.equal(shouldCancelStuck(hanging, AGENT_STUCK_CANCEL_MS), true);
  assert.equal(shouldCancelStuck(activity(), AGENT_STUCK_CANCEL_MS), true);
});

test("hangingToolName and logEntryStuckKind read the live agent log", () => {
  const now = Date.parse("2026-09-06T12:10:00.000Z");
  const entry: AgentLogEntry = {
    at: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:04:00.000Z",
    role: "tester",
    agentId: "t1",
    runId: "r9",
    status: "running",
    user: "test the game",
    steps: [{ type: "tool", name: "browser_navigate", status: "running" }],
  };
  assert.equal(hangingToolName(entry.steps), "browser_navigate");
  assert.equal(logEntryStuckKind(entry, now), "open_tool");
  entry.status = "finished";
  assert.equal(logEntryStuckKind(entry, now), undefined);
});

test("beginAgentWatch heartbeats, notifies once, then gives up", () => {
  let now = 0;
  const ticks: Array<() => void> = [];
  const lines: string[] = [];
  const stuck: string[] = [];
  const giveUp: string[] = [];
  const watch = beginAgentWatch({
    role: "tester",
    agentId: "a1",
    runId: "r1",
    now: () => now,
    intervalMs: 1,
    setIntervalFn: (fn) => {
      ticks.push(fn as () => void);
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => undefined,
    log: (line) => {
      lines.push(line);
    },
    onStuck: (current, kind) => {
      stuck.push(kind);
      assert.equal(current.runId, "r1");
    },
    onGiveUp: (_current, kind) => {
      giveUp.push(kind);
    },
  });
  watch.noteEvent({ type: "tool_call", name: "browser_navigate", status: "running" });
  assert.match(lines[0] ?? "", /browser_navigate running/);
  now = 60_000;
  ticks[0]?.();
  assert.ok(lines.some((line) => line.includes("waiting")));
  now = AGENT_STUCK_TOOL_MS;
  ticks[0]?.();
  now = AGENT_STUCK_TOOL_MS + 1;
  ticks[0]?.();
  assert.deepEqual(stuck, ["open_tool"]);
  now = AGENT_STUCK_CANCEL_MS;
  ticks[0]?.();
  assert.deepEqual(giveUp, ["open_tool"]);
  watch.stop();
});

test("formatStatusActivity mentions last event and stuck", () => {
  resetAgentIdle();
  const text = formatStatusActivity(
    activity({
      lastEventAt: 0,
      lastSummary: "tool browser_navigate running",
      openToolName: "browser_navigate",
      openToolAt: 0,
    }),
    AGENT_STUCK_TOOL_MS,
  );
  assert.match(text, /Tester r1/);
  assert.match(text, /browser_navigate/);
  assert.match(text, /possibly stuck/);
  assert.match(text, /\/egon-retry/);
});
