import assert from "node:assert/strict";
import { test } from "node:test";
import { FeatureStore } from "../features/store.js";
import { indexPage } from "./page.js";

const links = {
  gamePublicUrl: "https://lets-vibe-together.mbuelow.dev",
  gameRepoUrl: "https://github.com/mbuelowdev/lets-vibe-together",
};

const emptyStats = { tokens: 1_200_000, implemented: 3, durationMs: 90_000_000 };

test("index page shows lifetime token, feature, and agent-time stats", () => {
  const html = indexPage([], [], emptyStats, links);
  assert.match(html, /1\.2M/);
  assert.match(html, /lifetime tokens used/);
  assert.match(html, />3<\/strong><span>features implemented/);
  assert.match(html, /1d 1h/);
  assert.match(html, /lifetime agent time/);
});

test("index page links to the live game, repo, and each feature PR", () => {
  const store = new FeatureStore(":memory:");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  store.setGithubPr(planned.id, {
    branch: "egon/dash-hud",
    number: 12,
    url: "https://github.com/mbuelowdev/lets-vibe-together/pull/12",
  });
  const html = indexPage([store.getFeatureById(planned.id)!], [], emptyStats, links);
  store.close();
  assert.match(html, /href="https:\/\/lets-vibe-together\.mbuelow\.dev"/);
  assert.match(html, />Play the game</);
  assert.match(html, /href="https:\/\/github\.com\/mbuelowdev\/lets-vibe-together"/);
  assert.match(html, />Game repo</);
  assert.match(html, /href="https:\/\/github\.com\/mbuelowdev\/lets-vibe-together\/pull\/12"/);
  assert.match(html, /PR #12/);
});
