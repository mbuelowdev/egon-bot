import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion, versionIncreased } from "./version.js";

test("bumpVersion increments semver patch or integer", () => {
  assert.equal(bumpVersion("0.16.0"), "0.16.1");
  assert.equal(bumpVersion("12"), "13");
  assert.equal(bumpVersion(undefined), "0.0.1");
});

test("versionIncreased compares against origin", () => {
  assert.equal(versionIncreased("0.16.1", "0.16.0"), true);
  assert.equal(versionIncreased("0.16.0", "0.16.0"), false);
  assert.equal(versionIncreased("0.15.9", "0.16.0"), false);
});
