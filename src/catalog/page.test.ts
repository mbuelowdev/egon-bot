import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { featurePage, indexPage, renderAgentLog } from "./page.js";

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
  assert.match(html, /href="\/features\/dash-hud#agent-log"/);
  assert.match(html, />Agent log</);
});

test("index page lists collecting features separately from planned", () => {
  const store = new FeatureStore(":memory:");
  const idea = store.createFeature("Double jump", "channel-1");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const html = indexPage(
    [store.getFeatureById(planned.id)!],
    [],
    emptyStats,
    links,
    [store.getFeatureById(idea.id)!],
  );
  store.close();
  assert.match(html, /Collecting/);
  assert.match(html, /Double jump/);
  assert.match(html, /Dash HUD/);
  assert.match(html, /Ideas still being collected/);
  assert.match(html, /data-delete-slug="double-jump"/);
  assert.match(html, /window\.prompt\("Password"\)/);
  assert.doesNotMatch(html, /data-delete-slug="dash-hud"/);
});

test("collecting feature page includes a delete action; planned does not", () => {
  const store = new FeatureStore(":memory:");
  const idea = store.createFeature("Wall run", "channel-1");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const collectingHtml = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(idea.id)!,
  );
  const plannedHtml = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(planned.id)!,
  );
  store.close();
  assert.match(collectingHtml, /data-delete-slug="wall-run"/);
  assert.doesNotMatch(plannedHtml, /data-delete-slug="dash-hud"/);
});

test("feature page lists collected notes with HTML escaped", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash <HUD>", "channel-1");
  store.addNote(feature.id, "jump **higher** & faster");
  store.addNote(feature.id, "<script>alert(1)</script>");
  const html = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(feature.id)!,
    store.listNotes(feature.id),
  );
  store.close();
  assert.match(html, /Notes/);
  assert.match(html, /jump \*\*higher\*\* &amp; faster/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Dash &lt;HUD&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /id="agent-log"/);
  assert.match(html, /No agent log yet/);
});

test("feature page renders prompts, agent text, and tool calls from the log", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  const html = featurePage({ dataDir: "/tmp/egon-missing" } as Config, store.getFeatureById(feature.id)!, [], [
    {
      at: "2026-09-06T12:04:00.000Z",
      role: "planner",
      agentId: "p1",
      runId: "r1",
      status: "finished",
      user: "Write ONLY this file <SPEC>",
      result: "PLAN_COMPLETE",
      steps: [
        { type: "thinking", text: "secret chain" },
        { type: "tool", name: "read", args: { path: "player.gd" }, result: { status: "success" } },
        { type: "assistant", text: "PLAN_COMPLETE" },
      ],
    },
  ]);
  store.close();
  assert.match(html, /id="agent-log"/);
  assert.match(html, /Planner/);
  assert.match(html, /Write ONLY this file &lt;SPEC&gt;/);
  assert.match(html, /PLAN_COMPLETE/);
  assert.match(html, /read · player\.gd/);
  assert.match(html, /Thinking/);
  assert.match(html, /secret chain/);
});

test("renderAgentLog marks an in-progress run", () => {
  const html = renderAgentLog(
    [
      {
        at: "2026-09-06T12:04:00.000Z",
        updatedAt: "2026-09-06T12:04:20.000Z",
        role: "implementer",
        agentId: "i1",
        runId: "r2",
        status: "running",
        user: "implement it",
        steps: [{ type: "assistant", text: "editing player.gd" }],
      },
    ],
    Date.parse("2026-09-06T12:04:30.000Z"),
  );
  assert.match(html, /log-status-running/);
  assert.match(html, /last activity 10s ago/);
  assert.match(html, /editing player\.gd/);
});

test("renderAgentLog marks a silent running tester as possibly stuck", () => {
  const html = renderAgentLog(
    [
      {
        at: "2026-09-06T12:00:00.000Z",
        updatedAt: "2026-09-06T12:01:00.000Z",
        role: "tester",
        agentId: "t1",
        runId: "r9",
        status: "running",
        user: "test the game",
        steps: [{ type: "tool", name: "browser_navigate", status: "running" }],
      },
    ],
    Date.parse("2026-09-06T12:08:00.000Z"),
  );
  assert.match(html, /log-status-stuck/);
  assert.match(html, /possibly stuck on browser_navigate/);
});

test("renderAgentLog escapes untrusted prompt text", () => {
  const html = renderAgentLog([
    {
      at: "2026-09-06T12:04:00.000Z",
      role: "tester",
      agentId: "t1",
      runId: "r9",
      status: "error",
      user: "<img src=x onerror=alert(1)>",
      errorMessage: "boom <x>",
      steps: [],
    },
  ]);
  assert.match(html, /Tester/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /boom &lt;x&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});
