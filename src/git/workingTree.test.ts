import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { checkoutDefaultBranch, commitAndPush, createFeatureBranch, discardUncommittedWork } from "./workingTree.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initBareAndClone(): { origin: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), "egon-git-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--bare", origin], { encoding: "utf8" });
  execFileSync("git", ["clone", origin, work], { encoding: "utf8" });
  git(work, ["config", "user.name", "Egon"]);
  git(work, ["config", "user.email", "egon@localhost"]);
  git(work, ["checkout", "-b", "master"]);
  writeFileSync(join(work, "README.md"), "game\n");
  git(work, ["add", "README.md"]);
  git(work, ["commit", "-m", "init"]);
  git(work, ["push", "-u", "origin", "master"]);
  return { origin, work };
}

function testConfig(gameRepoDir: string) {
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
  });
}

test("createFeatureBranch starts from origin/master", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  const branch = await createFeatureBranch(config, "dash-hud");
  assert.equal(branch, "egon/dash-hud");
  assert.equal(git(work, ["rev-parse", "--abbrev-ref", "HEAD"]), "egon/dash-hud");
});

test("commitAndPush no-ops on a clean tree and pushes when dirty", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "dash");
  assert.equal(await commitAndPush(config, "empty"), false);
  mkdirSync(join(work, "docs", "features", "dash"), { recursive: true });
  writeFileSync(join(work, "docs", "features", "dash", "SPEC.md"), "# Dash\n");
  assert.equal(await commitAndPush(config, "egon: spec dash"), true);
  assert.match(git(work, ["log", "-1", "--pretty=%s"]), /egon: spec dash/);
});

test("checkoutDefaultBranch returns to master", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "dash");
  await checkoutDefaultBranch(config);
  assert.equal(git(work, ["rev-parse", "--abbrev-ref", "HEAD"]), "master");
});

test("discardUncommittedWork drops tracked and untracked edits", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "dash");
  writeFileSync(join(work, "README.md"), "dirty\n");
  writeFileSync(join(work, "scratch.txt"), "tmp\n");
  await discardUncommittedWork(config);
  assert.equal(git(work, ["status", "--porcelain"]), "");
  assert.equal(git(work, ["show", "HEAD:README.md"]), "game");
});
