import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, type Config } from "../config.js";
import {
  closePullRequest,
  createDraftPr,
  deployRunDurationMinutes,
  isClosedUnmergedView,
  isMergedView,
  markPrReady,
  mergePullRequest,
  runMatchesWait,
  viewPullRequest,
  waitForDeployWorkflow,
  type DeployWorkflowRun,
  type ExecGh,
} from "./github.js";

const config: Config = loadConfig({
  DISCORD_TOKEN: "token",
  DISCORD_APP_ID: "app",
  DISCORD_CHANNEL_ID: "channel",
  DISCORD_GUILD_ID: "guild",
  CURSOR_API_KEY: "cursor",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth",
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

test("closePullRequest is idempotent when already closed", async () => {
  const calls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    calls.push(args);
    throw new Error("X Pull request gh/game#12 (Dash) is already closed");
  };
  await closePullRequest(config, 12, execGh);
  assert.deepEqual(calls[0], ["pr", "close", "12"]);
});

test("closePullRequest closes an open PR", async () => {
  const execGh: ExecGh = async (_cwd, args) => {
    assert.deepEqual(args, ["pr", "close", "8"]);
    return { stdout: "", stderr: "" };
  };
  await closePullRequest(config, 8, execGh);
});

test("mergePullRequest uses gh pr merge", async () => {
  const execGh: ExecGh = async (_cwd, args) => {
    assert.deepEqual(args, ["pr", "merge", "12", "--squash"]);
    return { stdout: "", stderr: "" };
  };
  await mergePullRequest(config, 12, execGh);
});

test("mergePullRequest is idempotent when already merged", async () => {
  const execGh: ExecGh = async () => {
    throw new Error("X Pull request org/game#12 (Dash) was already merged");
  };
  await mergePullRequest(config, 12, execGh);
});

test("mergePullRequest still throws when GitHub refuses the merge", async () => {
  const execGh: ExecGh = async () => {
    throw new Error("X Pull request org/game#12 is not mergeable: dirty");
  };
  await assert.rejects(() => mergePullRequest(config, 12, execGh), /not mergeable/);
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
      mergeCommit: { oid: "abc123def" },
    }),
    stderr: "",
  });
  const view = await viewPullRequest(config, 3, execGh);
  assert.equal(isMergedView(view), true);
  assert.equal(isClosedUnmergedView(view), false);
  assert.equal(view.mergeCommit, "abc123def");
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
      mergeCommit: null,
    }),
    true,
  );
});

const deployListRow = {
  databaseId: 44,
  status: "completed",
  conclusion: "success",
  headSha: "abc123",
  url: "https://github.com/org/game/actions/runs/44",
  displayTitle: "Bump deployment.json",
  createdAt: "2026-09-06T18:00:00Z",
  updatedAt: "2026-09-06T18:04:00Z",
};

test("waitForDeployWorkflow returns a completed run matching HEAD", async () => {
  const calls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    calls.push(args);
    return { stdout: JSON.stringify([deployListRow]), stderr: "" };
  };
  const run = await waitForDeployWorkflow(
    config,
    { headSha: "abc123", appearTimeoutMs: 0, pollMs: 0 },
    execGh,
  );
  assert.equal(run.id, 44);
  assert.equal(run.conclusion, "success");
  assert.equal(calls[0]?.[1], "list");
});

test("waitForDeployWorkflow watches an in-progress run then reads the result", async () => {
  const calls: string[][] = [];
  const execGh: ExecGh = async (_cwd, args) => {
    calls.push(args);
    if (args[1] === "list") {
      return {
        stdout: JSON.stringify([{ ...deployListRow, status: "in_progress", conclusion: "" }]),
        stderr: "",
      };
    }
    if (args[1] === "watch") {
      return { stdout: "", stderr: "" };
    }
    return {
      stdout: JSON.stringify({ ...deployListRow, startedAt: "2026-09-06T18:00:30Z" }),
      stderr: "",
    };
  };
  const run = await waitForDeployWorkflow(config, { headSha: "abc123", pollMs: 0 }, execGh);
  assert.equal(run.id, 44);
  assert.deepEqual(
    calls.map((args) => args[1]),
    ["list", "watch", "view"],
  );
});

test("waitForDeployWorkflow times out when no matching run appears", async () => {
  const execGh: ExecGh = async () => ({ stdout: "[]", stderr: "" });
  await assert.rejects(
    () => waitForDeployWorkflow(config, { headSha: "missing", appearTimeoutMs: 0, pollMs: 0 }, execGh),
    /Timed out waiting for Build and deploy/,
  );
});

test("runMatchesWait ignores a completed run that started before the merge", () => {
  const oldRun: DeployWorkflowRun = {
    id: 44,
    status: "completed",
    conclusion: "success",
    headSha: "abc123",
    url: "https://github.com/org/game/actions/runs/44",
    displayTitle: "Bump deployment.json",
    createdAt: "2026-09-06T18:00:00Z",
    startedAt: null,
    updatedAt: "2026-09-06T18:04:00Z",
  };
  assert.equal(
    runMatchesWait(oldRun, {
      headSha: "abc123",
      createdAfterIso: "2026-09-06T19:00:00Z",
    }),
    false,
  );
  assert.equal(
    runMatchesWait(
      { ...oldRun, createdAt: "2026-09-06T19:01:00Z" },
      { headSha: "abc123", createdAfterIso: "2026-09-06T19:00:00Z" },
    ),
    true,
  );
});

test("waitForDeployWorkflow does not pick an older run for the same SHA", async () => {
  const execGh: ExecGh = async () => ({ stdout: JSON.stringify([deployListRow]), stderr: "" });
  await assert.rejects(
    () =>
      waitForDeployWorkflow(
        config,
        { headSha: "abc123", createdAfterIso: "2026-09-06T19:00:00Z", appearTimeoutMs: 0, pollMs: 0 },
        execGh,
      ),
    /Timed out waiting for Build and deploy/,
  );
});

test("waitForDeployWorkflow matches a post-merge run even if HEAD SHA is stale", async () => {
  const execGh: ExecGh = async () => ({
    stdout: JSON.stringify([
      { ...deployListRow, databaseId: 45, headSha: "newsha", createdAt: "2026-09-06T19:01:00Z" },
      deployListRow,
    ]),
    stderr: "",
  });
  const run = await waitForDeployWorkflow(
    config,
    { headSha: "stale", createdAfterIso: "2026-09-06T19:00:00Z", appearTimeoutMs: 0, pollMs: 0 },
    execGh,
  );
  assert.equal(run.id, 45);
});

test("deployRunDurationMinutes rounds up to at least one minute", () => {
  assert.equal(
    deployRunDurationMinutes({
      id: 1,
      status: "completed",
      conclusion: "success",
      headSha: "a",
      url: "https://example",
      displayTitle: "x",
      createdAt: "2026-09-06T18:00:00Z",
      startedAt: "2026-09-06T18:00:00Z",
      updatedAt: "2026-09-06T18:03:20Z",
    }),
    3,
  );
});
