import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTransition, canTransition } from "./state.js";

test("allowed pipeline transitions match SPEC", () => {
  assert.equal(canTransition("collecting", "planning"), true);
  assert.equal(canTransition("testing", "fixing"), true);
  assert.equal(canTransition("testing", "awaiting_review"), true);
  assert.equal(canTransition("fixing", "exporting"), true);
  assert.equal(canTransition("rejected", "pivoting"), true);
  assert.equal(canTransition("awaiting_review", "pivoting"), true);
  assert.equal(canTransition("awaiting_review", "accepted"), true);
  assert.equal(canTransition("implementing", "accepted"), true);
  assert.equal(canTransition("testing", "accepted"), true);
  assert.equal(canTransition("pivoting", "implementing"), true);
  assert.equal(canTransition("planning", "collecting"), true);
  assert.equal(canTransition("implementing", "awaiting_review"), true);
  assert.equal(canTransition("exporting", "fixing"), true);
  assert.equal(canTransition("exporting", "awaiting_review"), true);
  assert.equal(canTransition("fixing", "awaiting_review"), true);
  assert.equal(canTransition("pivoting", "awaiting_review"), true);
  assert.equal(canTransition("accepted", "planning"), false);
  assert.equal(canTransition("collecting", "implementing"), false);
});

test("assertTransition throws on illegal moves", () => {
  assert.throws(() => assertTransition("collecting", "accepted"), /collecting -> accepted/);
});
