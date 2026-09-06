import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverThreadAnswer, waitForThreadAnswer } from "./qaWaiters.js";

test("first waiter receives the delivered answer", async () => {
  const pending = waitForThreadAnswer("thread-1", 1000);
  assert.equal(deliverThreadAnswer("thread-1", "ship it"), true);
  assert.equal(await pending, "ship it");
  assert.equal(deliverThreadAnswer("thread-1", "late"), false);
});
