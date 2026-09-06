import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import { FeatureStore } from "./store.js";
import { copyFeatureAssets, featureAssetDir, safeAssetFileName } from "./artifacts.js";

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
