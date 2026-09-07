import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import { FeatureStore } from "./store.js";
import {
  copyFeatureAssets,
  copyFeatureSpec,
  featureAssetDir,
  featureBranchName,
  newFeatureBranchName,
  plannedAssetPath,
  safeAssetFileName,
} from "./artifacts.js";
import { requiredSpecHeadings, validateFeatureSpec } from "./specValidate.js";

test("safeAssetFileName keeps a simple name and strips path junk", () => {
  assert.equal(safeAssetFileName("hud.png", "x.png"), "hud.png");
  assert.equal(safeAssetFileName("../secret.png", "x.png"), "secret.png");
  assert.equal(safeAssetFileName("HUD Mock.png", "x.png"), "HUD-Mock.png");
  assert.equal(safeAssetFileName("...", "abc.png"), "abc.png");
});

test("copyFeatureAssets writes Discord images into assets/egon/{slug}/", () => {
  const root = mkdtempSync(join(tmpdir(), "egon-assets-"));
  const dataDir = join(root, "data");
  const gameRepoDir = join(root, "game");
  mkdirSync(gameRepoDir, { recursive: true });
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  mkdirSync(join(dataDir, "features", String(feature.id), "attachments"), { recursive: true });
  writeFileSync(join(dataDir, "features", String(feature.id), "attachments", "111.png"), "one");
  writeFileSync(join(dataDir, "features", String(feature.id), "attachments", "222.png"), "two");
  const first = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  const second = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "222.png",
  });
  const copied = copyFeatureAssets(
    { dataDir, gameRepoDir } as Config,
    feature,
    store.listAttachments(feature.id),
  );
  store.close();
  assert.deepEqual(copied, [
    join("assets", "egon", "dash-hud", "hud.png"),
    join("assets", "egon", "dash-hud", `hud-${String(second.id)}.png`),
  ]);
  assert.equal(
    readFileSync(join(gameRepoDir, "assets", "egon", "dash-hud", "hud.png"), "utf8"),
    "one",
  );
  assert.equal(
    readFileSync(join(gameRepoDir, "assets", "egon", "dash-hud", `hud-${String(second.id)}.png`), "utf8"),
    "two",
  );
  assert.equal(first.filename, "hud.png");
  assert.equal(featureAssetDir("dash-hud"), join("assets", "egon", "dash-hud"));
});

test("plannedAssetPath matches copyFeatureAssets dest names", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  const first = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  const second = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "222.png",
  });
  const attachments = store.listAttachments(feature.id);
  store.close();
  assert.equal(
    plannedAssetPath(feature.name, attachments, first.id),
    join("assets", "egon", "dash-hud", "hud.png"),
  );
  assert.equal(
    plannedAssetPath(feature.name, attachments, second.id),
    join("assets", "egon", "dash-hud", `hud-${String(second.id)}.png`),
  );
});

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
    if (heading === "## 7. Acceptance criteria") {
      chunks.push(
        "1. Keys: none. JS: `() => window.__egon.state()`. Then: `{ \"ready\": true }`.",
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
    /SPEC\.md failed schema check/,
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
