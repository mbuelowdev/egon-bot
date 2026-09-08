import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import { FeatureStore } from "./store.js";
import {
  copyFeatureSpec,
  featureBranchName,
  newFeatureBranchName,
} from "./artifacts.js";
import { requiredSpecHeadings, validateFeatureSpec } from "./specValidate.js";

test("newFeatureBranchName stamps UTC time down to seconds", () => {
  assert.equal(
    newFeatureBranchName("dash-hud", new Date("2026-09-06T17:36:33.847Z")),
    "egon/dash-hud-20260906T173633Z",
  );
  assert.notEqual(
    newFeatureBranchName("dash-hud", new Date("2026-09-06T17:36:33Z")),
    newFeatureBranchName("dash-hud", new Date("2026-09-06T17:36:34Z")),
  );
});

test("featureBranchName prefers the stored github branch", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  assert.equal(featureBranchName(feature), "egon/dash-hud");
  const named = store.setGithubBranch(feature.id, "egon/dash-hud-20260906T173633Z");
  store.close();
  assert.equal(featureBranchName(named), "egon/dash-hud-20260906T173633Z");
});

function validSpecMarkdown(): string {
  const chunks = ["# Dash HUD", ""];
  for (const heading of requiredSpecHeadings()) {
    chunks.push(heading, "");
    if (heading.endsWith("Acceptance criteria")) {
      chunks.push("1. The game reports ready once the scene has loaded.", "");
    } else if (heading.endsWith("Test scenarios")) {
      chunks.push("- `default` (existing) — the game as it normally boots.", "");
    } else if (heading.endsWith("Verification hooks")) {
      chunks.push(
        '- Mechanism: `get_node("/root/EgonBridge").register_field("ready", func(): return _ready)`.',
        "- Call: `window.__egon.state()` returns JSON.",
        "",
      );
    } else {
      chunks.push("Filled.", "");
    }
  }
  return chunks.join("\n");
}

test("copyFeatureSpec copies a valid spec into the feature data dir", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-spec-"));
  const dataDir = join(root, "data");
  const gameRepoDir = join(root, "game");
  const specDir = join(gameRepoDir, "docs", "features", "dash-hud");
  mkdirSync(specDir, { recursive: true });
  const markdown = validSpecMarkdown();
  assert.equal(validateFeatureSpec(markdown).ok, true);
  writeFileSync(join(specDir, "SPEC.md"), markdown);
  // The gate covers both planner outputs, so the checks file has to exist too.
  mkdirSync(join(gameRepoDir, "egon", "checks"), { recursive: true });
  writeFileSync(
    join(gameRepoDir, "egon", "checks", "dash-hud.json"),
    JSON.stringify([
      {
        name: "the game reports ready",
        scenario: "default",
        steps: [{ await: "window.__egon.state().ready", equals: true }],
      },
    ]),
  );
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  copyFeatureSpec({ dataDir, gameRepoDir } as Config, feature);
  store.close();
  assert.equal(readFileSync(join(dataDir, "features", String(feature.id), "SPEC.md"), "utf8"), markdown);
});

test("copyFeatureSpec refuses a spec that fails the schema gate", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-spec-bad-"));
  const dataDir = join(root, "data");
  const gameRepoDir = join(root, "game");
  const specDir = join(gameRepoDir, "docs", "features", "dash-hud");
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, "SPEC.md"), "# Dash HUD\n\n## Goal\n\nNope.\n");
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  assert.throws(
    () => copyFeatureSpec({ dataDir, gameRepoDir } as Config, feature),
    /failed schema check/,
  );
  store.close();
});

test("copyFeatureSpec still errors when the planner wrote no file", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-spec-missing-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  assert.throws(
    () => copyFeatureSpec({ dataDir: join(root, "data"), gameRepoDir: join(root, "game") } as Config, feature),
    /Planner did not write/,
  );
  store.close();
});
