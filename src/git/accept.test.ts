import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { cleanupAfterMerge } from "./accept.js";

test("cleanupAfterMerge marks accepted, releases the lock, and keeps proof files", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-cleanup-"));
  const gameRepoDir = mkdtempSync(join(tmpdir(), "egon-cleanup-game-"));
  writeFileSync(
    join(gameRepoDir, "project.godot"),
    '[application]\nconfig/features=PackedStringArray("4.4")\nrun/main_scene="res://main.tscn"\n',
  );
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
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_WEBHOOK_SECRET: "whsec",
    DATA_DIR: dataDir,
    GAME_REPO_DIR: gameRepoDir,
  });
  await cleanupAfterMerge(config, store, feature.id);
  assert.equal(store.getFeatureById(feature.id)?.state, "accepted");
  assert.equal(store.getFeatureById(feature.id)?.deployAnnounced, false);
  assert.equal(store.getPipelineLock(), undefined);
  assert.equal(existsSync(join(root, "SPEC.md")), true);
  assert.equal(existsSync(join(root, "screenshots", "01.png")), true);
  const map = readFileSync(join(dataDir, "GAME_MAP.md"), "utf8");
  assert.match(map, /Godot: 4\.4/);
  assert.match(map, /Main scene: res:\/\/main\.tscn/);
  store.close();
});
