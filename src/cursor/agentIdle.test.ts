import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeRunDurationMs,
  beginAgentIdle,
  endAgentIdle,
  resetAgentIdle,
  takeAgentIdleMs,
} from "./agentIdle.js";

test("activeRunDurationMs subtracts idle from wall-clock", () => {
  assert.equal(activeRunDurationMs(10_000, 4_000), 6_000);
  assert.equal(activeRunDurationMs(1_000, 5_000), 0);
  assert.equal(activeRunDurationMs(1_000, Number.NaN), 1_000);
});

test("idle accumulator only counts time between begin and end", async () => {
  resetAgentIdle();
  beginAgentIdle();
  await new Promise((resolve) => setTimeout(resolve, 40));
  endAgentIdle();
  const idle = takeAgentIdleMs();
  assert.ok(idle >= 30, `idle was ${String(idle)}`);
  assert.equal(takeAgentIdleMs(), 0);
});
