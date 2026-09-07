import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { checkoutDefaultBranch, commitAndPush, createFeatureBranch, discardUncommittedWork, featureBranchDiff, FEATURE_DIFF_MAX_CHARS, truncateForPrompt } from "./workingTree.js";

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
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
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
  const branch = await createFeatureBranch(config, "egon/dash-hud-20260906T173633Z");
  assert.equal(branch, "egon/dash-hud-20260906T173633Z");
  assert.equal(git(work, ["rev-parse", "--abbrev-ref", "HEAD"]), "egon/dash-hud-20260906T173633Z");
});

test("commitAndPush no-ops on a clean tree and pushes when dirty", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  assert.equal(await commitAndPush(config, "empty"), false);
  mkdirSync(join(work, "docs", "features", "dash"), { recursive: true });
  writeFileSync(join(work, "docs", "features", "dash", "SPEC.md"), "# Dash\n");
  assert.equal(await commitAndPush(config, "egon: spec dash"), true);
  assert.match(git(work, ["log", "-1", "--pretty=%s"]), /egon: spec dash/);
});

test("checkoutDefaultBranch returns to master", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  await checkoutDefaultBranch(config);
  assert.equal(git(work, ["rev-parse", "--abbrev-ref", "HEAD"]), "master");
});

test("commitAndPush succeeds when an older same-slug branch already exists", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173000Z");
  mkdirSync(join(work, "docs", "features", "dash"), { recursive: true });
  writeFileSync(join(work, "docs", "features", "dash", "SPEC.md"), "# Old\n");
  assert.equal(await commitAndPush(config, "egon: spec dash old"), true);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  mkdirSync(join(work, "docs", "features", "dash"), { recursive: true });
  writeFileSync(join(work, "docs", "features", "dash", "SPEC.md"), "# New\n");
  assert.equal(await commitAndPush(config, "egon: spec dash new"), true);
  assert.equal(git(work, ["rev-parse", "--abbrev-ref", "HEAD"]), "egon/dash-20260906T173633Z");
});

test("discardUncommittedWork drops tracked and untracked edits", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  writeFileSync(join(work, "README.md"), "dirty\n");
  writeFileSync(join(work, "scratch.txt"), "tmp\n");
  await discardUncommittedWork(config);
  assert.equal(git(work, ["status", "--porcelain"]), "");
  assert.equal(git(work, ["show", "HEAD:README.md"]), "game");
});

test("featureBranchDiff returns committed feature work vs origin/master", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  mkdirSync(join(work, "scripts"), { recursive: true });
  writeFileSync(join(work, "scripts", "player.gd"), "extends Node\n");
  assert.equal(await commitAndPush(config, "egon: implement dash"), true);
  const diff = await featureBranchDiff(config);
  assert.match(diff, /player\.gd/);
  assert.match(diff, /extends Node/);
  assert.doesNotMatch(diff, /Uncommitted/);
});

test("featureBranchDiff appends uncommitted edits and truncates", async () => {
  const { work } = initBareAndClone();
  const config = testConfig(work);
  await createFeatureBranch(config, "egon/dash-20260906T173633Z");
  writeFileSync(join(work, "README.md"), "uncommitted dash notes\n");
  const diff = await featureBranchDiff(config);
  assert.match(diff, /Uncommitted/);
  assert.match(diff, /uncommitted dash notes/);
  const truncated = await featureBranchDiff(config, 40);
  assert.match(truncated, /truncated/);
  assert.ok(truncated.length < 120);
});

test("truncateForPrompt is a no-op under the cap", () => {
  assert.equal(truncateForPrompt("abc", FEATURE_DIFF_MAX_CHARS), "abc");
});
