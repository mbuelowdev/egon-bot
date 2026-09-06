import assert from "node:assert/strict";
import { test } from "node:test";
import { ThreadWaitCancelledError } from "../discord/qaWaiters.js";
import type { Feature } from "../features/store.js";
import { isPipelineStopError, PipelineStoppedError, shouldHaltPipeline } from "./halt.js";

function feature(state: Feature["state"]): Feature {
  return { id: 1, name: "Dash", state } as Feature;
}

test("shouldHaltPipeline is false only while plan/implement/test work is active", () => {
  assert.equal(shouldHaltPipeline(feature("planning")), false);
  assert.equal(shouldHaltPipeline(feature("implementing")), false);
  assert.equal(shouldHaltPipeline(feature("testing")), false);
  assert.equal(shouldHaltPipeline(feature("collecting")), true);
  assert.equal(shouldHaltPipeline(feature("awaiting_review")), true);
  assert.equal(shouldHaltPipeline(feature("accepted")), true);
});

test("isPipelineStopError covers abort, waiter cancel, and stop", () => {
  assert.equal(isPipelineStopError(new PipelineStoppedError()), true);
  assert.equal(isPipelineStopError(new ThreadWaitCancelledError()), true);
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.equal(isPipelineStopError(abort), true);
  assert.equal(isPipelineStopError(new Error("boom")), false);
});
