import assert from "node:assert/strict";
import { test } from "node:test";
import { featureSlug } from "./slug.js";

test("featureSlug normalizes names", () => {
  assert.equal(featureSlug("Dash HUD"), "dash-hud");
  assert.equal(featureSlug("  Hello_World  "), "hello-world");
  assert.equal(featureSlug("***"), "feature");
});
