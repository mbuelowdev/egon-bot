import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import type { SDKAgent } from "@cursor/sdk";
import {
  applyStreamEvent,
  beginLiveRunLog,
  flattenConversation,
  readAgentLog,
  upsertAgentLog,
  type AgentLogEntry,
} from "./agentLog.js";

function emptyEntry(overrides: Partial<AgentLogEntry> = {}): AgentLogEntry {
  return {
    at: "2026-09-06T12:00:00.000Z",
    role: "planner",
    agentId: "a1",
    runId: "r1",
    status: "running",
    user: "go",
    steps: [],
    ...overrides,
  };
}

test("flattenConversation keeps the user prompt and assistant, thinking, and tool steps", () => {
  const turns = [
    {
      type: "agentConversationTurn",
      turn: {
        userMessage: { text: "Write the spec" },
        steps: [
          { type: "thinkingMessage", message: { text: "hmm" } },
          {
            type: "toolCall",
            message: {
              type: "read",
              args: { path: "docs/features/dash/SPEC.md" },
              result: { status: "success", value: "ok" },
            },
          },
          { type: "assistantMessage", message: { text: "PLAN_COMPLETE" } },
        ],
      },
    },
  ];
  const flat = flattenConversation(turns, "fallback");
  assert.equal(flat.user, "Write the spec");
  assert.deepEqual(flat.steps, [
    { type: "thinking", text: "hmm" },
    {
      type: "tool",
      name: "read",
      status: undefined,
      args: { path: "docs/features/dash/SPEC.md" },
      result: { status: "success", value: "ok" },
    },
    { type: "assistant", text: "PLAN_COMPLETE" },
  ]);
});

test("flattenConversation falls back to the prompt we sent when the turn has no user message", () => {
  const flat = flattenConversation(
    [{ type: "agentConversationTurn", turn: { steps: [{ type: "assistantMessage", message: { text: "hi" } }] } }],
    "our prompt",
  );
  assert.equal(flat.user, "our prompt");
  assert.deepEqual(flat.steps, [{ type: "assistant", text: "hi" }]);
});

test("appendAgentLog writes JSONL that readAgentLog round-trips", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-agent-log-"));
  upsertAgentLog(dataDir, 7, {
    at: "2026-09-06T12:00:00.000Z",
    role: "planner",
    agentId: "a1",
    runId: "r1",
    status: "finished",
    user: "plan this",
    result: "PLAN_COMPLETE",
    steps: [{ type: "assistant", text: "PLAN_COMPLETE" }],
  });
  upsertAgentLog(dataDir, 7, {
    at: "2026-09-06T12:05:00.000Z",
    role: "implementer",
    agentId: "a2",
    runId: "r2",
    status: "finished",
    user: "implement it",
    steps: [
      { type: "tool", name: "edit", args: { path: "player.gd" } },
      { type: "assistant", text: "done" },
    ],
  });
  const loaded = readAgentLog(dataDir, 7);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]?.role, "planner");
  assert.equal(loaded[0]?.user, "plan this");
  assert.equal(loaded[1]?.role, "implementer");
  assert.equal(loaded[1]?.steps[0]?.type, "tool");
  const raw = readFileSync(join(dataDir, "features", "7", "agent-log.jsonl"), "utf8");
  assert.equal(raw.trim().split("\n").length, 2);
});

test("upsertAgentLog replaces an in-flight run instead of duplicating it", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-agent-log-"));
  upsertAgentLog(dataDir, 1, emptyEntry({ status: "running", user: "prompt" }));
  upsertAgentLog(
    dataDir,
    1,
    emptyEntry({
      status: "running",
      user: "prompt",
      steps: [{ type: "assistant", text: "working" }],
    }),
  );
  const loaded = readAgentLog(dataDir, 1);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.steps[0]?.type, "assistant");
  if (loaded[0]?.steps[0]?.type === "assistant") {
    assert.equal(loaded[0].steps[0].text, "working");
  }
});

test("applyStreamEvent appends assistant chunks and upgrades a tool call", () => {
  const entry = emptyEntry();
  applyStreamEvent(entry, {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hel" }] },
  });
  applyStreamEvent(entry, {
    type: "assistant",
    message: { content: [{ type: "text", text: "lo" }] },
  });
  assert.deepEqual(entry.steps[0], { type: "assistant", text: "Hello" });
  applyStreamEvent(entry, {
    type: "tool_call",
    call_id: "c1",
    name: "read",
    status: "running",
    args: { path: "a.ts" },
  });
  applyStreamEvent(entry, {
    type: "tool_call",
    call_id: "c1",
    name: "read",
    status: "completed",
    result: { ok: true },
  });
  assert.equal(entry.steps.length, 2);
  assert.equal(entry.steps[1]?.type, "tool");
  if (entry.steps[1]?.type === "tool") {
    assert.equal(entry.steps[1].status, "completed");
    assert.deepEqual(entry.steps[1].args, { path: "a.ts" });
    assert.deepEqual(entry.steps[1].result, { ok: true });
  }
});

test("applyStreamEvent treats a longer snapshot as a replacement, not a second copy", () => {
  const entry = emptyEntry();
  applyStreamEvent(entry, {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hi" }] },
  });
  applyStreamEvent(entry, {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hi there" }] },
  });
  assert.deepEqual(entry.steps, [{ type: "assistant", text: "Hi there" }]);
});

test("beginLiveRunLog writes the prompt immediately and flushes tool calls", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-agent-log-"));
  const live = beginLiveRunLog(
    { config: { dataDir } as Config, featureId: 3, role: "planner", model: "grok 4.6 high" },
    { agentId: "p1" } as SDKAgent,
    "Write the spec",
    "run-1",
  );
  const started = readAgentLog(dataDir, 3);
  assert.equal(started.length, 1);
  assert.equal(started[0]?.status, "running");
  assert.equal(started[0]?.user, "Write the spec");
  assert.equal(started[0]?.model, "grok 4.6 high");
  live.applyEvent({
    type: "tool_call",
    call_id: "c1",
    name: "read",
    status: "running",
    args: { path: "SPEC.md" },
  });
  const mid = readAgentLog(dataDir, 3);
  assert.equal(mid.length, 1);
  assert.equal(mid[0]?.steps[0]?.type, "tool");
  await live.finish({ status: "finished", result: "PLAN_COMPLETE" }, undefined);
  const done = readAgentLog(dataDir, 3);
  assert.equal(done.length, 1);
  assert.equal(done[0]?.status, "finished");
  assert.equal(done[0]?.result, "PLAN_COMPLETE");
  assert.equal(done[0]?.model, "grok 4.6 high");
});

