import assert from "node:assert/strict";
import { test } from "node:test";
import { lifetimeTokensStatus } from "./presence.js";

test("lifetimeTokensStatus is the presence sentence", () => {
  assert.equal(lifetimeTokensStatus(1_200_000), "1.2M lifetime token used on debian-4c-8gb");
  assert.equal(lifetimeTokensStatus(0), "0 lifetime token used on debian-4c-8gb");
});
