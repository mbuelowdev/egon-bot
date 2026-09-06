import assert from "node:assert/strict";
import { test } from "node:test";
import { isInConfiguredChannel } from "./threads.js";

test("commands in the configured channel or its threads are allowed", () => {
  assert.equal(isInConfiguredChannel("chan", null, "chan"), true);
  assert.equal(isInConfiguredChannel("thread", "chan", "chan"), true);
  assert.equal(isInConfiguredChannel("other", null, "chan"), false);
  assert.equal(isInConfiguredChannel("thread", "other", "chan"), false);
});
