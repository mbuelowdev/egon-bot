import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { recordEvent } from "../events/log.js";
import { FeatureStore, UserFacingError } from "../features/store.js";
import { serveCatalog, stopCatalogServer, CATALOG_DELETE_PASSWORD } from "./serve.js";
import type { GithubWebhookEvent } from "./webhook.js";

async function freePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve) => {
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        throw new Error("no port");
      }
      probe.close();
      resolve(address.port);
    });
  });
}

test("catalog lists collecting, planned, and implemented features with spec and screenshots", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-"));
  const store = new FeatureStore(":memory:");
  const collecting = store.createFeature("Wall run", "channel-1");
  store.addNote(collecting.id, "hold jump against a wall");
  const collectingShot = store.addAttachment(collecting.id, {
    filename: "wall.png",
    mimeType: "image/png",
    storedName: "wall-ref.png",
  });
  mkdirSync(join(dataDir, "features", String(collecting.id), "attachments"), { recursive: true });
  writeFileSync(
    join(dataDir, "features", String(collecting.id), "attachments", collectingShot.storedName),
    "ref-png",
  );
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const specDir = join(dataDir, "features", String(planned.id));
  mkdirSync(join(specDir, "screenshots"), { recursive: true });
  writeFileSync(join(specDir, "SPEC.md"), "# Dash HUD\n\n1. See the speed\n");
  writeFileSync(join(specDir, "screenshots", "criterion-1.png"), "png");
  writeFileSync(
    join(specDir, "agent-log.jsonl"),
    `${JSON.stringify({
      at: "2026-09-06T12:04:00.000Z",
      role: "planner",
      agentId: "p1",
      runId: "r1",
      status: "finished",
      user: "Write the Dash HUD spec",
      result: "PLAN_COMPLETE",
      steps: [{ type: "assistant", text: "PLAN_COMPLETE" }],
    })}\n`,
  );
  const done = store.createFeature("Jump", "channel-1");
  store.transition(done.id, "planning");
  store.transition(done.id, "implementing");
  store.transition(done.id, "accepted");
  store.setGithubPr(done.id, {
    branch: "egon/jump",
    number: 7,
    url: "https://github.com/org/game/pull/7",
  });
  store.recordAgentRunTokens("run-1", "agent-a", 1_200_000, 3_720_000);
  mkdirSync(join(dataDir, "features", String(done.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(done.id), "SPEC.md"), "# Jump\n");

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  const events: GithubWebhookEvent[] = [];
  await serveCatalog({
    store,
    config,
    onGithubEvent: async (event) => {
      events.push(event);
    },
  });
  try {
    const index = await fetch(`http://127.0.0.1:${String(port)}/`);
    const indexHtml = await index.text();
    assert.equal(index.status, 200);
    assert.match(indexHtml, /Wall run/);
    assert.match(indexHtml, /Collecting/);
    assert.match(indexHtml, /Dash HUD/);
    assert.match(indexHtml, /Jump/);
    assert.match(indexHtml, /Planned/);
    assert.match(indexHtml, /Implemented/);
    assert.match(indexHtml, /lifetime tokens used/);
    assert.match(indexHtml, /1\.2M/);
    assert.match(indexHtml, />1<\/strong><span>feature implemented/);
    assert.match(indexHtml, /1h 2m/);
    assert.match(indexHtml, /lifetime agent time/);
    assert.match(indexHtml, /Play the game/);
    assert.match(indexHtml, /href="https:\/\/lets-vibe-together\.mbuelow\.dev"/);
    assert.match(indexHtml, /Game repo/);
    assert.match(indexHtml, /href="https:\/\/github\.com\/org\/game"/);
    assert.match(indexHtml, />Upload assets</);
    assert.match(indexHtml, /href="\/assets"/);
    assert.doesNotMatch(indexHtml, /sharing service/);

    const portal = await fetch(`http://127.0.0.1:${String(port)}/assets`);
    assert.equal(portal.status, 200);
    const portalHtml = await portal.text();
    assert.match(portalHtml, /<title>Egon asset library<\/title>/);
    assert.match(portalHtml, /Drop files here/);
    assert.match(indexHtml, /PR #7/);
    assert.match(indexHtml, /href="https:\/\/github\.com\/org\/game\/pull\/7"/);
    assert.match(indexHtml, /data-delete-slug="wall-run"/);
    assert.match(indexHtml, /data-delete-slug="dash-hud"/);
    assert.match(indexHtml, /data-delete-slug="jump"/);
    assert.match(indexHtml, /rel="icon" href="\/favicon.ico"/);

    const favicon = await fetch(`http://127.0.0.1:${String(port)}/favicon.ico`);
    assert.equal(favicon.status, 200);
    assert.equal(favicon.headers.get("content-type"), "image/x-icon");
    assert.ok((await favicon.arrayBuffer()).byteLength > 0);

    const faviconPng = await fetch(`http://127.0.0.1:${String(port)}/favicon.png`);
    assert.equal(faviconPng.status, 200);
    assert.equal(faviconPng.headers.get("content-type"), "image/png");

    const appleIcon = await fetch(`http://127.0.0.1:${String(port)}/apple-touch-icon.png`);
    assert.equal(appleIcon.status, 200);
    assert.equal(appleIcon.headers.get("content-type"), "image/png");

    const idea = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run`);
    const ideaHtml = await idea.text();
    assert.equal(idea.status, 200);
    assert.match(ideaHtml, /hold jump against a wall/);
    assert.match(ideaHtml, /collecting/);
    assert.match(ideaHtml, /Reference images/);
    assert.match(ideaHtml, /wall\.png/);

    const ref = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run/attachments/wall-ref.png`);
    assert.equal(ref.status, 200);
    assert.equal(await ref.text(), "ref-png");

    const detail = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /See the speed/);
    assert.match(detailHtml, /criterion-1\.png/);
    assert.match(detailHtml, /Agent log/);
    assert.match(detailHtml, /Write the Dash HUD spec/);
    assert.match(detailHtml, /PLAN_COMPLETE/);

    const shot = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/screenshots/criterion-1.png`);
    assert.equal(shot.status, 200);
    assert.equal(await shot.text(), "png");

    const body = Buffer.from(
      JSON.stringify({ action: "closed", pull_request: { number: 9, merged: true } }),
    );
    const digest = createHmac("sha256", "whsec").update(body).digest("hex");
    const webhook = await fetch(`http://127.0.0.1:${String(port)}/github/webhook`, {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": `sha256=${digest}`,
        "X-GitHub-Event": "pull_request",
      },
      body,
    });
    assert.equal(webhook.status, 204);
    assert.deepEqual(events, [{ kind: "merged", number: 9 }]);

    const deployBody = Buffer.from(
      JSON.stringify({
        action: "completed",
        workflow: { path: ".github/workflows/build-and-deploy.yml" },
        workflow_run: {
          id: 88,
          name: "Build and deploy",
          conclusion: "success",
          head_branch: "master",
          html_url: "https://github.com/org/game/actions/runs/88",
          display_title: "Bump",
          run_started_at: "2026-09-06T18:00:00Z",
          updated_at: "2026-09-06T18:02:00Z",
          head_commit: { message: "Bump" },
        },
      }),
    );
    const deployDigest = createHmac("sha256", "whsec").update(deployBody).digest("hex");
    const deployWebhook = await fetch(`http://127.0.0.1:${String(port)}/github/webhook`, {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": `sha256=${deployDigest}`,
        "X-GitHub-Event": "workflow_run",
      },
      body: deployBody,
    });
    assert.equal(deployWebhook.status, 204);
    assert.equal(events.at(-1)?.kind, "deployed");

    const bad = await fetch(`http://127.0.0.1:${String(port)}/github/webhook`, {
      method: "POST",
      headers: { "X-Hub-Signature-256": "sha256=nope", "X-GitHub-Event": "pull_request" },
      body,
    });
    assert.equal(bad.status, 401);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("catalog index lists a planning feature before SPEC.md exists", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-planning-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(feature.id);

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
  });
  try {
    const index = await fetch(`http://127.0.0.1:${String(port)}/`);
    const indexHtml = await index.text();
    assert.equal(index.status, 200);
    assert.match(indexHtml, /Dash HUD/);
    assert.match(indexHtml, />planning</);
    assert.match(indexHtml, /href="\/features\/dash-hud"/);

    const detail = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`);
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /No spec on file yet/);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("catalog deletes collecting, planned, and implemented features after the shared password", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-delete-"));
  const store = new FeatureStore(":memory:");
  const collecting = store.createFeature("Wall run", "channel-1");
  store.addNote(collecting.id, "hold jump against a wall");
  mkdirSync(join(dataDir, "features", String(collecting.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(collecting.id), "notes.txt"), "scratch");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  store.setGithubPr(planned.id, {
    branch: "egon/dash-hud",
    number: 12,
    url: "https://github.com/org/game/pull/12",
  });
  const done = store.createFeature("Jump", "channel-1");
  store.transition(done.id, "planning");
  store.transition(done.id, "implementing");
  store.transition(done.id, "accepted");
  store.setGithubPr(done.id, {
    branch: "egon/jump",
    number: 7,
    url: "https://github.com/org/game/pull/7",
  });
  mkdirSync(join(dataDir, "features", String(done.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(done.id), "SPEC.md"), "# Jump\n");
  const closedPrs: number[] = [];

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
    closePullRequest: async (number) => {
      closedPrs.push(number);
    },
  });
  try {
    const wrong = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal(store.getFeatureById(collecting.id)?.name, "Wall run");

    const ok = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(ok.status, 204);
    assert.equal(store.getFeatureById(collecting.id), undefined);
    assert.equal(existsSync(join(dataDir, "features", String(collecting.id))), false);

    const gone = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run`);
    assert.equal(gone.status, 404);

    const plannedOk = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(plannedOk.status, 204);
    assert.equal(store.getFeatureById(planned.id), undefined);
    assert.deepEqual(closedPrs, [12]);

    const implemented = await fetch(`http://127.0.0.1:${String(port)}/features/jump/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(implemented.status, 204);
    assert.equal(store.getFeatureById(done.id), undefined);
    assert.equal(existsSync(join(dataDir, "features", String(done.id))), false);
    assert.deepEqual(closedPrs, [12]);

    const goneImplemented = await fetch(`http://127.0.0.1:${String(port)}/features/jump`);
    assert.equal(goneImplemented.status, 404);

    const index = await fetch(`http://127.0.0.1:${String(port)}/`);
    const indexHtml = await index.text();
    assert.doesNotMatch(indexHtml, /Wall run/);
    assert.doesNotMatch(indexHtml, /Dash HUD/);
    assert.doesNotMatch(indexHtml, /Jump/);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("catalog syncs a merged PR into Implemented before rendering", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-sync-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("2d scene with background and player circle", "channel-1");
  store.startPlanning(feature.id);
  store.transition(feature.id, "implementing");
  store.transition(feature.id, "awaiting_review");
  store.setGithubPr(feature.id, {
    branch: "egon/2d-scene",
    number: 4,
    url: "https://github.com/mbuelowdev/lets-vibe-together/pull/4",
  });
  mkdirSync(join(dataDir, "features", String(feature.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(feature.id), "SPEC.md"), "# Scene\n");

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  let synced = 0;
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
    syncGithub: async () => {
      synced += 1;
      const current = store.getFeatureById(feature.id);
      if (current && current.state !== "accepted") {
        store.transition(feature.id, "accepted");
      }
    },
  });
  try {
    const index = await fetch(`http://127.0.0.1:${String(port)}/`);
    const indexHtml = await index.text();
    assert.equal(index.status, 200);
    assert.equal(synced, 1);
    assert.match(indexHtml, /Implemented/);
    assert.match(indexHtml, /2d scene with background and player circle/);
    assert.doesNotMatch(indexHtml, />awaiting_review</);
    assert.equal(store.getFeatureById(feature.id)?.state, "accepted");

    const detail = await fetch(
      `http://127.0.0.1:${String(port)}/features/2d-scene-with-background-and-player-circle`,
    );
    assert.equal(detail.status, 200);
    assert.equal(synced, 2);
    assert.match(await detail.text(), />accepted</);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("catalog retry uses the shared password and only retries the locked feature", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-retry-"));
  const store = new FeatureStore(":memory:");
  const other = store.createFeature("Jump", "channel-1");
  store.transition(other.id, "planning");
  store.transition(other.id, "implementing");
  store.transition(other.id, "accepted");
  const active = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(active.id);
  const retried: string[] = [];
  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
    retry: async () => {
      retried.push("ok");
      return "Retrying Dash HUD from planning.";
    },
  });
  try {
    const detail = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`);
    assert.equal(detail.status, 200);
    const html = await detail.text();
    assert.match(html, /data-retry-slug="dash-hud"/);
    assert.match(
      html,
      /class="feature-actions">[\s\S]*data-retry-slug="dash-hud"[\s\S]*data-delete-slug="dash-hud"/,
    );

    const wrong = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(wrong.status, 403);
    assert.deepEqual(retried, []);

    const notLocked = await fetch(`http://127.0.0.1:${String(port)}/features/jump/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(notLocked.status, 409);
    assert.match(await notLocked.text(), /not the active pipeline feature/);
    assert.deepEqual(retried, []);

    const ok = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "Retrying Dash HUD from planning.");
    assert.deepEqual(retried, ["ok"]);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("catalog retry surfaces pipeline UserFacingError", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-retry-err-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(feature.id);
  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
    retry: async () => {
      throw new UserFacingError("Cannot retry from collecting.");
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(response.status, 409);
    assert.equal(await response.text(), "Cannot retry from collecting.");
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("the /events route renders the pipeline log grouped by feature and phase", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-events-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  recordEvent(dataDir, {
    at: "2026-09-08T10:00:00.000Z",
    featureId: feature.id,
    feature: feature.name,
    slug: "dash-hud",
    phase: "export",
    step: "Export succeeded",
    level: "success",
  });
  recordEvent(dataDir, {
    at: "2026-09-08T10:00:12.000Z",
    featureId: feature.id,
    feature: feature.name,
    slug: "dash-hud",
    phase: "suite",
    step: "FAIL victory screen",
    level: "failure",
    detail: "expected 4200, actual 0",
  });

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
  });
  try {
    const res = await fetch(`http://127.0.0.1:${String(port)}/events`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>Pipeline events<\/h1>/);
    assert.match(html, /<section class="event-feature" id="feature-dash-hud">/);
    assert.match(html, /<span class="event-phase">export<\/span>/);
    assert.match(html, /<span class="event-phase">suite<\/span>/);
    assert.match(html, /expected 4200, actual 0/);
    // The trailing-slash form is the same page, not a 404.
    const slash = await fetch(`http://127.0.0.1:${String(port)}/events/`);
    assert.equal(slash.status, 200);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("the index and feature pages both link to the pipeline events", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-eventlink-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(feature.id);
  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({ store, config, onGithubEvent: async () => {} });
  try {
    const index = await (await fetch(`http://127.0.0.1:${String(port)}/`)).text();
    assert.match(index, /<a href="\/events">Pipeline events<\/a>/);
    const detail = await (await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`)).text();
    assert.match(detail, /href="\/events#feature-dash-hud"/);
    // The agent log section stays where it was.
    assert.match(detail, /id="agent-log"/);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});

test("the /events/fragment route answers 304 for an unchanged log and 200 once it moves", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-fragment-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("Dash HUD", "channel-1");
  const base = {
    featureId: feature.id,
    feature: feature.name,
    slug: "dash-hud",
    phase: "suite" as const,
    level: "success" as const,
  };
  recordEvent(dataDir, { ...base, at: "2026-09-08T10:00:00.000Z", step: "PASS first check" });

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({ store, config, onGithubEvent: async () => {} });
  try {
    const url = `http://127.0.0.1:${String(port)}/events/fragment`;
    const first = await fetch(url);
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.ok(etag && etag.length > 2, "fragment must carry an ETag");
    const html = await first.text();
    assert.match(html, /PASS first check/);
    // The fragment is sections only: the poll swaps it into the existing shell.
    assert.doesNotMatch(html, /<!doctype html>/i);

    const unchanged = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");

    recordEvent(dataDir, { ...base, at: "2026-09-08T10:00:20.000Z", step: "PASS second check" });
    const moved = await fetch(url, { headers: { "If-None-Match": etag } });
    assert.equal(moved.status, 200);
    assert.notEqual(moved.headers.get("etag"), etag);
    assert.match(await moved.text(), /PASS second check/);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});
