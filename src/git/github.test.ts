import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, type Config } from "../config.js";
import {
  createDraftPr,
  isClosedUnmergedView,
  isMergedView,
  markPrReady,
  viewPullRequest,
  type ExecGh,
} from "./github.js";

const config: Config = loadConfig({
  DISCORD_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_CHANNEL_ID: "channel",
  DISCORD_GUILD_ID: "guild",
  CURSOR_API_KEY: "cursor",
  GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
  GITHUB_TOKEN: "ghp_test",
  GITHUB_WEBHOOK_SECRET: "whsec",
  GAME_REPO_DIR: "/game",
});

test("createDraftPr uses gh pr create --draft and parses the URL", async () => {
  const calls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    calls.push(args);
    return { stdout: "https://github.com/org/game/pull/42\n", stderr: "" };
  };
  const pr = await createDraftPr(config, { title: "Dash HUD", body: "See SPEC.md" }, execGh);
  assert.equal(pr.number, 42);
  assert.equal(pr.url, "https://github.com/org/game/pull/42");
  assert.deepEqual(calls[0], [
    "pr",
    "create",
    "--draft",
    "--base",
    "master",
    "--title",
    "Dash HUD",
    "--body",
    "See SPEC.md",
  ]);
});

test("createDraftPr falls back to gh pr view when the PR already exists", async () => {
  const execGh: ExecGh = async (_cwd, args) => {
    if (args[1] === "create") {
      throw new Error("a pull request for branch \"egon/dash\" already exists");
    }
    return {
      stdout: JSON.stringify({
        number: 7,
        url: "https://github.com/org/game/pull/7",
        state: "OPEN",
        mergedAt: null,
        closedAt: null,
        isDraft: true,
      }),
      stderr: "",
    };
  };
  const pr = await createDraftPr(config, { title: "Dash", body: "body" }, execGh);
  assert.equal(pr.number, 7);
});

test("markPrReady is idempotent when already ready", async () => {
  const execGh: ExecGh = async () => {
    throw new Error("Pull request #9 is already marked as ready for review");
  };
  await markPrReady(config, 9, execGh);
});

test("viewPullRequest parses merged and closed JSON", async () => {
  const execGh: ExecGh = async () => ({
    stdout: JSON.stringify({
      number: 3,
      url: "https://github.com/org/game/pull/3",
      state: "MERGED",
      mergedAt: "2026-09-05T00:00:00Z",
      closedAt: "2026-09-05T00:00:00Z",
      isDraft: false,
    }),
    stderr: "",
  });
  const view = await viewPullRequest(config, 3, execGh);
  assert.equal(isMergedView(view), true);
  assert.equal(isClosedUnmergedView(view), false);
});

test("closed without merge is rejected, not accepted", () => {
  assert.equal(
    isClosedUnmergedView({
      number: 1,
      url: "https://github.com/org/game/pull/1",
      state: "CLOSED",
      mergedAt: null,
      closedAt: "2026-09-05T00:00:00Z",
      isDraft: false,
    }),
    true,
  );
});
