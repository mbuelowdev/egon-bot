import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import type { ExecGh } from "./github.js";
import { setupGitHubGitAuth, syncGameRepo, type ExecGit } from "./repo.js";

function testConfig(gameRepoDir: string, dataDir?: string) {
  return loadConfig({
    DISCORD_TOKEN: "token",
    DISCORD_APP_ID: "app",
    DISCORD_CHANNEL_ID: "channel",
    DISCORD_GUILD_ID: "guild",
    CURSOR_API_KEY: "cursor",
    GAME_REPO_HTTPS_URL: "https://github.com/org/game.git",
    GITHUB_TOKEN: "ghp_test",
    GITHUB_WEBHOOK_SECRET: "whsec",
    GAME_REPO_DIR: gameRepoDir,
    GAME_REPO_BRANCH: "master",
    ...(dataDir ? { DATA_DIR: dataDir } : {}),
  });
}

test("setupGitHubGitAuth runs gh auth setup-git", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-gh-auth-"));
  const calls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    calls.push(args);
    return { stdout: "", stderr: "" };
  };
  await setupGitHubGitAuth(testConfig("/game", dataDir), execGh);
  assert.deepEqual(calls, [["auth", "setup-git"]]);
});

test("syncGameRepo clones with gh repo clone when the dir is empty", async () => {
  const root = mkdtempSync(join(tmpdir(), "egon-clone-"));
  const dest = join(root, "game");
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    ghCalls.push(args);
    return { stdout: "", stderr: "" };
  };
  const execGit: ExecGit = async (args) => {
    gitCalls.push(args);
  };
  await syncGameRepo(testConfig(dest), execGh, execGit);
  assert.deepEqual(ghCalls, [
    ["repo", "clone", "https://github.com/org/game.git", dest, "--", "--branch", "master"],
  ]);
  assert.deepEqual(gitCalls, []);
});

test("syncGameRepo fetches when the dir is already a git checkout", async () => {
  const dest = mkdtempSync(join(tmpdir(), "egon-fetch-"));
  mkdirSync(join(dest, ".git"));
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    ghCalls.push(args);
    return { stdout: "", stderr: "" };
  };
  const execGit: ExecGit = async (args) => {
    gitCalls.push(args);
  };
  await syncGameRepo(testConfig(dest), execGh, execGit);
  assert.deepEqual(ghCalls, []);
  assert.deepEqual(gitCalls, [
    ["-C", dest, "remote", "set-url", "origin", "https://github.com/org/game.git"],
    ["-C", dest, "fetch", "origin"],
  ]);
});

test("syncGameRepo refuses a non-git occupied directory", async () => {
  const dest = mkdtempSync(join(tmpdir(), "egon-occupied-"));
  writeFileSync(join(dest, "readme.txt"), "nope\n");
  await assert.rejects(
    () => syncGameRepo(testConfig(dest), async () => ({ stdout: "", stderr: "" })),
    /exists and is not a git checkout/,
  );
});
