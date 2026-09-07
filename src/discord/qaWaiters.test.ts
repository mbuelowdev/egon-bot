import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelAllQuestionWaiters, deliverQuestionAnswer, waitForQuestionAnswer } from "./qaWaiters.js";

test("first waiter receives the delivered answer", async () => {
  const pending = waitForQuestionAnswer(1, 1000);
  assert.equal(deliverQuestionAnswer(1, "ship it"), true);
  assert.equal(await pending, "ship it");
  assert.equal(deliverQuestionAnswer(1, "late"), false);
});

test("question wait times out with QuestionWaitTimeoutError", async () => {
  const pending = waitForQuestionAnswer(3, 20);
  await assert.rejects(pending, { name: "QuestionWaitTimeoutError" });
});

test("cancelAllQuestionWaiters rejects the pending waiter", async () => {
  const pending = waitForQuestionAnswer(2, 1000);
  cancelAllQuestionWaiters();
  await assert.rejects(pending, /Pipeline stopped/);
  assert.equal(deliverQuestionAnswer(2, "too late"), false);
});
