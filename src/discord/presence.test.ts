import assert from "node:assert/strict";
import { test } from "node:test";
import { lifetimeTokensStatus } from "./presence.js";

test("lifetimeTokensStatus is the presence sentence", () => {
  assert.equal(lifetimeTokensStatus(1_200_000), "1.2M lifetime tokens used");
  assert.equal(lifetimeTokensStatus(0), "0 lifetime tokens used");
});
