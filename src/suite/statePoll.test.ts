import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EGON_STATE_POLL_EVALUATE,
  EGON_STATE_SETTLE_MS,
  EGON_STATE_TIMEOUT_MS,
  egonStatePollEvaluateSource,
  type EgonStatePollResult,
} from "./statePoll.js";

type Poll<T> = () => Promise<EgonStatePollResult<T>>;

/** Same trick as the boot wait: the prompt ships a source string, so run the string. */
function compile<T>(readBody: string, settleMs = 40, timeoutMs = 400, pollMs = 5): Poll<T> {
  return eval(`(${egonStatePollEvaluateSource(readBody, { settleMs, timeoutMs, pollMs })})`) as Poll<T>;
}

test("settle-poll returns a value that is already stable", async () => {
  const result = await compile<number>("7")();
  assert.equal(result.value, 7);
  assert.equal(result.first, 7);
  assert.equal(result.changed, false);
  assert.equal(result.settled, true);
  assert.ok(result.samples >= 2);
});

test("settle-poll waits out a value that is still moving, then reports it changed", async () => {
  const state = { x: 0 };
  Object.defineProperty(globalThis, "__egonTestState", { value: state, configurable: true, writable: true });
  try {
    const timer = setInterval(() => {
      if (state.x < 5) {
        state.x += 10;
      }
    }, 5);
    try {
      const result = await compile<number>("globalThis.__egonTestState.x")();
      assert.equal(result.settled, true);
      assert.equal(result.changed, true);
      assert.equal(result.first, 0);
      assert.equal(result.value, 10);
    } finally {
      clearInterval(timer);
    }
  } finally {
    Reflect.deleteProperty(globalThis, "__egonTestState");
  }
});

test("settle-poll snapshots the first sample instead of aliasing a mutated object", async () => {
  const live = { score: 0 };
  Object.defineProperty(globalThis, "__egonTestState", { value: live, configurable: true, writable: true });
  try {
    setTimeout(() => {
      live.score = 42;
    }, 15);
    const result = await compile<{ score: number }>("globalThis.__egonTestState")();
    assert.deepEqual(result.first, { score: 0 });
    assert.deepEqual(result.value, { score: 42 });
    assert.equal(result.changed, true);
  } finally {
    Reflect.deleteProperty(globalThis, "__egonTestState");
  }
});

test("settle-poll gives up on a value that never stops moving", async () => {
  let tick = 0;
  Object.defineProperty(globalThis, "__egonTestTick", {
    value: () => (tick += 1),
    configurable: true,
    writable: true,
  });
  try {
    const result = await compile<number>("globalThis.__egonTestTick()", 100, 150, 5)();
    assert.equal(result.settled, false);
    assert.equal(result.changed, true);
    assert.ok(result.ms >= 150);
  } finally {
    Reflect.deleteProperty(globalThis, "__egonTestTick");
  }
});

test("settle-poll reports a broken bridge as an error field instead of rejecting", async () => {
  const result = await compile<null>("window.__egon.state()")();
  assert.equal(result.value, null);
  assert.match(result.error ?? "", /window|not defined/i);
  assert.equal(result.settled, false);
});

test("settle-poll stays well under Playwright's evaluate timeout", () => {
  assert.ok(EGON_STATE_TIMEOUT_MS < 30_000);
  assert.ok(EGON_STATE_SETTLE_MS < EGON_STATE_TIMEOUT_MS);
  assert.equal(EGON_STATE_POLL_EVALUATE, egonStatePollEvaluateSource());
  assert.match(EGON_STATE_POLL_EVALUATE, /const read = \(\) => window\.__egon\.state\(\)/);
});

