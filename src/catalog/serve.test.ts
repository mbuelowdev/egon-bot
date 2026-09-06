import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { FeatureStore } from "../features/store.js";
import { serveCatalog, stopCatalogServer } from "./serve.js";
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

test("catalog lists planned and implemented features with spec and screenshots", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-catalog-"));
  const store = new FeatureStore(":memory:");
  const planned = store.createFeature("Dash HUD", "channel-1");
  store.startPlanning(planned.id);
  const specDir = join(dataDir, "features", String(planned.id));
  mkdirSync(join(specDir, "screenshots"), { recursive: true });
  writeFileSync(join(specDir, "SPEC.md"), "# Dash HUD\n\n1. See the speed\n");
  writeFileSync(join(specDir, "screenshots", "01.png"), "png");
  const done = store.createFeature("Jump", "channel-1");
  store.transition(done.id, "planning");
  store.transition(done.id, "implementing");
  store.transition(done.id, "accepted");
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
    assert.match(indexHtml, /Dash HUD/);
    assert.match(indexHtml, /Jump/);
    assert.match(indexHtml, /Planned/);
    assert.match(indexHtml, /Implemented/);

    const detail = await fetch(`http://127.0.0.1:${String(port)}/features/dash-hud`);
    const detailHtml = await detail.text();
    assert.match(detailHtml, /See the speed/);
    assert.match(detailHtml, /01\.png/);

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
