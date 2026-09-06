import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { cleanupAfterMerge } from "./accept.js";

test("cleanupAfterMerge marks accepted, releases the lock, and keeps proof files", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-cleanup-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.startPlanning(feature.id);
  store.transition(feature.id, "implementing");
  const root = join(dataDir, "features", String(feature.id));
  mkdirSync(join(root, "screenshots"), { recursive: true });
  writeFileSync(join(root, "SPEC.md"), "# Dash\n");
  writeFileSync(join(root, "screenshots", "01.png"), "png");
  const config = loadConfig({
    DISCORD_TOKEN: "token",
    DISCORD_APP_ID: "app",
    DISCORD_CHANNEL_ID: "channel",
    DISCORD_GUILD_ID: "guild",
    CURSOR_API_KEY: "cursor",
    GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_WEBHOOK_SECRET: "whsec",
    DATA_DIR: dataDir,
  });
  await cleanupAfterMerge(config, store, feature.id);
  assert.equal(store.getFeatureById(feature.id)?.state, "accepted");
  assert.equal(store.getPipelineLock(), undefined);
  assert.equal(existsSync(join(root, "SPEC.md")), true);
  assert.equal(existsSync(join(root, "screenshots", "01.png")), true);
  store.close();
});
