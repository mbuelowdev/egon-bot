import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogUrl,
  cursorModelForRole,
  featurePageUrl,
  githubRepoSlug,
  githubRepoWebUrl,
  loadConfig,
} from "./config.js";

const validEnv: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_CHANNEL_ID: "channel",
  DISCORD_GUILD_ID: "guild",
  CURSOR_API_KEY: "cursor",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth",
  GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
  GITHUB_TOKEN: "ghp_test",
  GITHUB_WEBHOOK_SECRET: "whsec",
};

test("loadConfig fails fast when a required var is missing", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, DISCORD_CHANNEL_ID: "" }),
    /Missing required environment variable: DISCORD_CHANNEL_ID/,
  );
});

test("loadConfig fails fast when GitHub vars are missing", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, GITHUB_TOKEN: "" }),
    /Missing required environment variable: GITHUB_TOKEN/,
  );
  assert.throws(
    () => loadConfig({ ...validEnv, GITHUB_WEBHOOK_SECRET: "" }),
    /Missing required environment variable: GITHUB_WEBHOOK_SECRET/,
  );
  assert.throws(
    () => loadConfig({ ...validEnv, GAME_REPO_HTTPS_URL: "" }),
    /Missing required environment variable: GAME_REPO_HTTPS_URL/,
  );
  assert.throws(
    () => loadConfig({ ...validEnv, CLAUDE_CODE_OAUTH_TOKEN: "" }),
    /Missing required environment variable: CLAUDE_CODE_OAUTH_TOKEN/,
  );
});

test("loadConfig rejects a non-HTTPS game repo URL", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, GAME_REPO_HTTPS_URL: "git@github.com:org/game.git" }),
    /GAME_REPO_HTTPS_URL must be an HTTPS git URL/,
  );
});

test("loadConfig applies documented defaults", () => {
  const config = loadConfig(validEnv);
  assert.equal(config.gameRepoDir, "/game");
  assert.equal(config.gameRepoBranch, "master");
  assert.equal(config.gitAuthorName, "Egon");
  assert.equal(config.gitAuthorEmail, "egon@localhost");
  assert.equal(config.cursorModelImplementer, "grok-4.6");
  assert.deepEqual(config.cursorModelImplementerParams, [{ id: "reasoning", value: "high" }]);
  assert.equal(config.cursorModelTester, "composer-2.5");
  assert.deepEqual(config.cursorModelTesterParams, [{ id: "reasoning", value: "low" }]);
  assert.deepEqual(cursorModelForRole(config, "implementer"), {
    id: "grok-4.6",
    params: [{ id: "reasoning", value: "high" }],
  });
  assert.deepEqual(cursorModelForRole(config, "planner"), {
    id: "grok-4.6",
    params: [{ id: "reasoning", value: "high" }],
  });
  assert.deepEqual(cursorModelForRole(config, "tester"), {
    id: "composer-2.5",
    params: [{ id: "reasoning", value: "low" }],
  });
  assert.equal(config.claudeCodeOAuthToken, "oauth");
  assert.equal(config.dataDir, "/data");
  assert.equal(config.webServePort, 8080);
  assert.equal(config.featuresHttpPort, 10001);
  assert.equal(config.featuresPublicUrl, "https://egon.mbuelow.dev");
  assert.equal(config.cursorAdminApiKey, undefined);
  assert.equal(config.cursorOrganizationId, undefined);
  assert.equal(config.githubToken, "ghp_test");
  assert.equal(config.githubWebhookSecret, "whsec");
  assert.equal(config.gameRepoHttpsUrl, "https://github.com/org/game.git");
  assert.equal(config.gamePublicUrl, "https://lets-vibe-together.mbuelow.dev");
});

test("loadConfig splits implementer and tester Cursor models and effort", () => {
  const config = loadConfig({
    ...validEnv,
    CURSOR_MODEL_IMPLEMENTER: "composer-2.5",
    CURSOR_MODEL_IMPLEMENTER_EFFORT: "xhigh",
    CURSOR_MODEL_TESTER: "grok-4.6",
    CURSOR_MODEL_TESTER_EFFORT: "medium",
  });
  assert.deepEqual(cursorModelForRole(config, "implementer"), {
    id: "composer-2.5",
    params: [{ id: "reasoning", value: "xhigh" }],
  });
  assert.deepEqual(cursorModelForRole(config, "tester"), {
    id: "grok-4.6",
    params: [{ id: "reasoning", value: "medium" }],
  });
});

test("loadConfig rejects an unknown Cursor reasoning effort", () => {
  assert.throws(
    () => loadConfig({ ...validEnv, CURSOR_MODEL_TESTER_EFFORT: "ultra" }),
    /Invalid CURSOR_MODEL_TESTER_EFFORT: expected one of none, low, medium, high, xhigh/,
  );
});

test("catalogUrl strips trailing slash on FEATURES_PUBLIC_URL", () => {
  const config = loadConfig({ ...validEnv, FEATURES_PUBLIC_URL: "https://egon.example/" });
  assert.equal(config.featuresPublicUrl, "https://egon.example");
  assert.equal(catalogUrl(config, "/features/dash"), "https://egon.example/features/dash");
});

test("catalogUrl uses the default public catalog when FEATURES_PUBLIC_URL is unset", () => {
  assert.equal(catalogUrl(loadConfig(validEnv)), "https://egon.mbuelow.dev/");
});

test("featurePageUrl slugs the feature name onto the catalog", () => {
  const config = loadConfig({ ...validEnv, FEATURES_PUBLIC_URL: "https://egon.example/" });
  assert.equal(featurePageUrl(config, "Dash HUD"), "https://egon.example/features/dash-hud");
  assert.equal(featurePageUrl(loadConfig(validEnv), "Dash HUD"), "https://egon.mbuelow.dev/features/dash-hud");
});

test("githubRepoWebUrl strips .git from the clone URL", () => {
  assert.equal(
    githubRepoWebUrl("https://github.com/mbuelowdev/lets-vibe-together.git"),
    "https://github.com/mbuelowdev/lets-vibe-together",
  );
});

test("githubRepoSlug is owner/repo", () => {
  assert.equal(
    githubRepoSlug("https://github.com/mbuelowdev/lets-vibe-together.git"),
    "mbuelowdev/lets-vibe-together",
  );
});
