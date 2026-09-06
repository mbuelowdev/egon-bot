import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { featurePage, indexPage, renderAgentLog } from "./page.js";

const links = {
  gamePublicUrl: "https://lets-vibe-together.mbuelow.dev",
  gameRepoUrl: "https://github.com/mbuelowdev/lets-vibe-together",
};

const emptyStats = { tokens: 1_200_000, implemented: 3, durationMs: 90_000_000 };

test("catalog pages use a Discord-like dark palette", () => {
  const html = indexPage([], [], emptyStats, links);
  assert.match(html, /--paper: #313338/);
  assert.match(html, /--panel: #2b2d31/);
  assert.match(html, /--accent: #5865f2/);
  assert.match(html, /--danger: #ed4245/);
  assert.doesNotMatch(html, /--amber:/);
});

test("index page shows lifetime token, feature, and agent-time stats", () => {
  const html = indexPage([], [], emptyStats, links);
  assert.match(html, /1\.2M/);
  assert.match(html, /lifetime tokens used/);
  assert.match(html, />3<\/strong><span>features implemented/);
  assert.match(html, /1d 1h/);
  assert.match(html, /lifetime agent time/);
});

test("index page links to the live game, repo, file sharing, and each feature PR", () => {
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
  assert.match(html, /href="https:\/\/discord\.mbuelow\.dev"/);
  assert.match(html, />Upload assets</);
  assert.match(html, /Host sprites, audio, and other files on the sharing service/);
  assert.match(html, /href="https:\/\/github\.com\/mbuelowdev\/lets-vibe-together\/pull\/12"/);
  assert.match(html, /PR #12/);
  assert.doesNotMatch(html, /#agent-log/);
  assert.doesNotMatch(html, />Agent log</);
  assert.match(html, /data-delete-slug="dash-hud"/);
});

test("index page lists collecting features separately from planned", () => {
  const store = new FeatureStore(":memory:");
  const idea = store.createFeature("Double jump", "channel-1");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const done = store.createFeature("Jump", "channel-1");
  store.transition(done.id, "planning");
  store.transition(done.id, "implementing");
  store.transition(done.id, "accepted");
  const html = indexPage(
    [store.getFeatureById(planned.id)!],
    [store.getFeatureById(done.id)!],
    emptyStats,
    links,
    [store.getFeatureById(idea.id)!],
  );
  store.close();
  assert.match(html, /Collecting/);
  assert.match(html, /Double jump/);
  assert.match(html, /Dash HUD/);
  assert.match(html, /Jump/);
  assert.match(html, /Ideas still being collected/);
  assert.match(html, /data-delete-slug="double-jump"/);
  assert.match(html, /window\.prompt\("Password"\)/);
  assert.match(html, /data-delete-slug="dash-hud"/);
  assert.match(html, /data-delete-slug="jump"/);
});

test("collecting, planned, and implemented feature pages include a delete action", () => {
  const store = new FeatureStore(":memory:");
  const idea = store.createFeature("Wall run", "channel-1");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const done = store.createFeature("Jump", "channel-1");
  store.transition(done.id, "planning");
  store.transition(done.id, "implementing");
  store.transition(done.id, "accepted");
  const collectingHtml = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(idea.id)!,
  );
  const plannedHtml = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(planned.id)!,
  );
  const doneHtml = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(done.id)!,
  );
  store.close();
  assert.match(collectingHtml, /data-delete-slug="wall-run"/);
  assert.match(collectingHtml, /class="back" href="\/"/);
  assert.match(collectingHtml, /aria-label="Back to feature log"/);
  assert.match(collectingHtml, /class="back"[^>]*>\s*<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(collectingHtml, />←</);
  assert.doesNotMatch(collectingHtml, /title-row/);
  assert.doesNotMatch(collectingHtml, />Feature log</);
  assert.doesNotMatch(collectingHtml, /href="#agent-log"/);
  assert.match(plannedHtml, /data-delete-slug="dash-hud"/);
  assert.doesNotMatch(plannedHtml, /href="#agent-log"/);
  assert.match(doneHtml, /data-delete-slug="jump"/);
});

test("closed PR is labeled closed on index and detail pages", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/dash-hud",
    number: 12,
    url: "https://github.com/mbuelowdev/lets-vibe-together/pull/12",
  });
  store.transition(feature.id, "rejected");
  const closed = store.getFeatureById(feature.id)!;
  const indexHtml = indexPage([closed], [], emptyStats, links);
  const detailHtml = featurePage({ dataDir: "/tmp/egon-missing" } as Config, closed);
  store.close();
  assert.match(indexHtml, /PR #12 \(closed\)/);
  assert.match(detailHtml, /class="github-pr closed"/);
  assert.match(detailHtml, /PR #12 \(closed\)/);
  assert.match(detailHtml, /data-delete-slug="dash-hud"/);
});

test("feature page PR is a GitHub-icon button", () => {
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(feature.id);
  store.setGithubPr(feature.id, {
    branch: "egon/dash-hud",
    number: 12,
    url: "https://github.com/mbuelowdev/lets-vibe-together/pull/12",
  });
  const html = featurePage(
    { dataDir: "/tmp/egon-missing" } as Config,
    store.getFeatureById(feature.id)!,
  );
  store.close();
  assert.match(html, /class="github-pr"/);
  assert.match(html, /href="https:\/\/github\.com\/mbuelowdev\/lets-vibe-together\/pull\/12"/);
  assert.match(html, /PR #12/);
  assert.match(html, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(html, /class="feature-actions"/);
  assert.match(
    html,
    /class="feature-actions">[\s\S]*class="github-pr"[\s\S]*data-delete-slug="dash-hud"/,
  );
  assert.doesNotMatch(html, /<p class="meta"><a href="https:\/\/github\.com/);
  assert.doesNotMatch(html, /<p class="links">[\s\S]*data-delete-slug/);
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

test("feature page shows a circular color dot next to hex colors in notes and spec", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-page-hex-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Palette", "channel-1");
  store.addNote(feature.id, "primary is #ababab");
  mkdirSync(join(dataDir, "features", String(feature.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(feature.id), "SPEC.md"), "Accent `#5865f2`");
  const html = featurePage(
    { dataDir } as Config,
    store.getFeatureById(feature.id)!,
    store.listNotes(feature.id),
  );
  store.close();
  assert.match(html, /\.color-dot \{/);
  assert.match(html, /border-radius: 50%/);
  assert.match(
    html,
    /primary is #ababab<span class="color-dot" style="background:#ababab" aria-hidden="true"><\/span>/,
  );
  assert.match(
    html,
    /<code>#5865f2<span class="color-dot" style="background:#5865f2" aria-hidden="true"><\/span><\/code>/,
  );
});

test("feature page opens proof screenshots in a lightbox", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-page-shot-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  mkdirSync(join(dataDir, "features", String(feature.id), "screenshots"), { recursive: true });
  writeFileSync(join(dataDir, "features", String(feature.id), "screenshots", "01.png"), "png");
  const html = featurePage({ dataDir } as Config, store.getFeatureById(feature.id)!);
  store.close();
  assert.match(html, /<h2>Proof<\/h2>/);
  assert.match(html, /\/features\/dash-hud\/screenshots\/01\.png/);
  assert.match(html, /cursor: zoom-in/);
  assert.match(html, /overlay\.className = "lightbox"/);
  assert.match(html, /background: #000000b8/);
  assert.match(html, /querySelectorAll\("\.shots img"\)/);
  assert.match(html, /event\.target !== img/);
  assert.match(html, /classList\.add\("is-open"\)/);
  assert.match(html, /classList\.remove\("is-open"\)/);
});

test("feature page shows Discord reference images", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-page-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  const attachment = store.addAttachment(feature.id, {
    filename: "hud mock.png",
    mimeType: "image/png",
    storedName: "abc.png",
  });
  mkdirSync(join(dataDir, "features", String(feature.id), "attachments"), { recursive: true });
  writeFileSync(join(dataDir, "features", String(feature.id), "attachments", attachment.storedName), "png");
  const html = featurePage(
    { dataDir } as Config,
    store.getFeatureById(feature.id)!,
    [],
    [],
    store.listAttachments(feature.id),
  );
  store.close();
  assert.match(html, /Reference images/);
  assert.match(html, /hud mock\.png/);
  assert.match(html, /\/features\/dash-hud\/attachments\/abc\.png/);
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
        { type: "thinking", text: "secret **chain**\n\n1. consider the spec" },
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
  assert.match(html, /secret <strong>chain<\/strong>/);
  assert.match(html, /<li>consider the spec<\/li>/);
  assert.match(html, /class="log-msg thinking"/);
  assert.match(html, /class="thinking-body spec"/);
  assert.match(html, /data-run-id="r1"/);
  assert.match(html, /class="log-run" data-run-id="r1" open>/);
  assert.match(html, /egon-agent-log:/);
  assert.match(html, /localStorage/);
});

test("renderAgentLog leaves every run collapsed except the last", () => {
  const html = renderAgentLog([
    {
      at: "2026-09-06T12:00:00.000Z",
      role: "planner",
      agentId: "p1",
      runId: "r1",
      status: "finished",
      user: "plan it",
      steps: [],
    },
    {
      at: "2026-09-06T12:10:00.000Z",
      role: "implementer",
      agentId: "i1",
      runId: "r2",
      status: "finished",
      user: "build it",
      steps: [],
    },
  ]);
  assert.match(html, /class="log-run" data-run-id="r1">/);
  assert.match(html, /class="log-run" data-run-id="r2" open>/);
  assert.doesNotMatch(html, /data-run-id="r1" open/);
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
