import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { serveCatalog, stopCatalogServer, CATALOG_DELETE_PASSWORD } from "./serve.js";
import type { GithubPrEvent } from "./webhook.js";

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
  writeFileSync(join(specDir, "screenshots", "01.png"), "png");
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
    GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_WEBHOOK_SECRET: "whsec",
    DATA_DIR: dataDir,
    FEATURES_HTTP_PORT: String(port),
  });
  const events: GithubPrEvent[] = [];
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
    assert.match(indexHtml, /href="https:\/\/discord\.mbuelow\.dev"/);
    assert.match(indexHtml, /PR #7/);
    assert.match(indexHtml, /href="https:\/\/github\.com\/org\/game\/pull\/7"/);
    assert.match(indexHtml, /data-delete-slug="wall-run"/);
    assert.doesNotMatch(indexHtml, /data-delete-slug="dash-hud"/);
    assert.doesNotMatch(indexHtml, /data-delete-slug="jump"/);

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
    assert.match(detailHtml, /01\.png/);
    assert.match(detailHtml, /Agent log/);
    assert.match(detailHtml, /Write the Dash HUD spec/);
    assert.match(detailHtml, /PLAN_COMPLETE/);

    const shot = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/screenshots/01.png`);
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

test("catalog deletes collecting features after the shared password", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-delete-"));
  const store = new FeatureStore(":memory:");
  const collecting = store.createFeature("Wall run", "channel-1");
  store.addNote(collecting.id, "hold jump against a wall");
  mkdirSync(join(dataDir, "features", String(collecting.id)), { recursive: true });
  writeFileSync(join(dataDir, "features", String(collecting.id), "notes.txt"), "scratch");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);

  const port = await freePort();
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
    FEATURES_HTTP_PORT: String(port),
  });
  await serveCatalog({
    store,
    config,
    onGithubEvent: async () => {},
  });
  try {
    const wrong = await fetch(`http://127.0.0.1:${String(port)}/features/wall-run/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal(store.getFeatureById(collecting.id)?.name, "Wall run");

    const blocked = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: CATALOG_DELETE_PASSWORD }),
    });
    assert.equal(blocked.status, 409);
    assert.equal(store.getFeatureById(planned.id)?.state, "planning");

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

    const stillPlanned = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`);
    assert.equal(stillPlanned.status, 200);
    assert.equal(store.getFeatureById(planned.id)?.state, "planning");

    const index = await fetch(`http://127.0.0.1:${String(port)}/`);
    const indexHtml = await index.text();
    assert.doesNotMatch(indexHtml, /Wall run/);
  } finally {
    await stopCatalogServer();
    store.close();
  }
});
