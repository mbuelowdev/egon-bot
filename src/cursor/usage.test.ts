import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchRemainingUsagePercent,
  parsePlanUsage,
  parsePooledUsage,
  remainingPercent,
} from "./usage.js";

test("remainingPercent is remaining/limit as an integer", () => {
  assert.equal(remainingPercent(73, 100), 73);
  assert.equal(remainingPercent(0, 100), 0);
  assert.equal(remainingPercent(10, 0), undefined);
});

test("parsePooledUsage reads remainingCents / limitCents", () => {
  assert.equal(
    parsePooledUsage({ pool: { remainingCents: 2500, limitCents: 5000 } }),
    50,
  );
});

test("parsePlanUsage uses remaining or includedSpend vs limit", () => {
  assert.equal(parsePlanUsage({ planUsage: { remaining: 80, limit: 100 } }), 80);
  assert.equal(parsePlanUsage({ planUsage: { includedSpend: 25, limit: 100 } }), 75);
});

test("fetchRemainingUsagePercent never throws", async () => {
  const snapshot = await fetchRemainingUsagePercent(
    { cursorApiKey: "key" },
    async () => {
      throw new Error("network down");
    },
  );
  assert.deepEqual(snapshot, { kind: "unavailable" });
});
