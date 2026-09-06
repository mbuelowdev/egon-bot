import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancelActiveAgentRun,
  clearAgentCancel,
  isAgentCancelRequested,
  setActiveAgentRun,
} from "./activeRun.js";

test("cancelActiveAgentRun flags cancel and cancels the active run", async () => {
  clearAgentCancel();
  let cancelled = false;
  setActiveAgentRun({
    supports: (operation) => operation === "cancel",
    cancel: async () => {
      cancelled = true;
    },
  });
  await cancelActiveAgentRun();
  assert.equal(isAgentCancelRequested(), true);
  assert.equal(cancelled, true);
  setActiveAgentRun(undefined);
  clearAgentCancel();
  assert.equal(isAgentCancelRequested(), false);
});

test("cancelActiveAgentRun still flags cancel when no run is active", async () => {
  clearAgentCancel();
  setActiveAgentRun(undefined);
  await cancelActiveAgentRun();
  assert.equal(isAgentCancelRequested(), true);
  clearAgentCancel();
});
