import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlanMarker } from "./planMarker.js";

test("parsePlanMarker reads a one-line marker", () => {
  assert.equal(parsePlanMarker("Wrote the spec.\nPLAN_COMPLETE"), "PLAN_COMPLETE");
  assert.equal(parsePlanMarker("Need art direction.\nPLAN_BLOCKED"), "PLAN_BLOCKED");
  assert.equal(parsePlanMarker("still thinking"), null);
});
