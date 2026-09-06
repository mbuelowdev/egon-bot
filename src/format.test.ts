import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, formatTokenCount } from "./format.js";

test("formatTokenCount compacts thousands and millions", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1000), "1k");
  assert.equal(formatTokenCount(1500), "1.5k");
  assert.equal(formatTokenCount(12_400), "12k");
  assert.equal(formatTokenCount(1_200_000), "1.2M");
  assert.equal(formatTokenCount(12_000_000), "12M");
});

test("formatDuration compacts wall-clock", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(4000), "4s");
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatDuration(120_000), "2m");
  assert.equal(formatDuration(3_720_000), "1h 2m");
  assert.equal(formatDuration(90_000_000), "1d 1h");
});
