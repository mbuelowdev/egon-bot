import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { decorateHexColors, renderMarkdown } from "./markdown.js";
import { parseGithubPullRequestEvent, parseGithubWebhookEvent, verifyGithubSignature } from "./webhook.js";

test("renderMarkdown turns headings, lists, and bold into HTML", () => {
  const html = renderMarkdown("# Title\n\n**Acceptance criteria**\n\n1. Click play\n2. See HUD\n");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>Acceptance criteria<\/strong>/);
  assert.match(html, /<li>Click play<\/li>/);
  assert.match(html, /<li>See HUD<\/li>/);
});

test("renderMarkdown escapes HTML", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("renderMarkdown shows a color dot next to hex colors", () => {
  const html = renderMarkdown("Use **#ababab** and `#fff` plus #23a559");
  assert.match(
    html,
    /#ababab<span class="color-dot" style="background:#ababab" aria-hidden="true"><\/span>/,
  );
  assert.match(html, /<code>#fff<span class="color-dot" style="background:#fff" aria-hidden="true"><\/span><\/code>/);
  assert.match(html, /#23a559<span class="color-dot" style="background:#23a559"/);
});

test("decorateHexColors ignores short fragments and HTML entities", () => {
  assert.equal(decorateHexColors("PR #12 and &#39;ok&#39;"), "PR #12 and &#39;ok&#39;");
  assert.equal(decorateHexColors("#gggggg not hex"), "#gggggg not hex");
});

test("verifyGithubSignature accepts a matching HMAC", () => {
  const secret = "whsec";
  const body = Buffer.from('{"ok":true}', "utf8");
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyGithubSignature(secret, body, `sha256=${digest}`), true);
  assert.equal(verifyGithubSignature(secret, body, "sha256=deadbeef"), false);
  assert.equal(verifyGithubSignature(secret, body, undefined), false);
});

test("parseGithubPullRequestEvent maps merged and closed", () => {
  assert.deepEqual(
    parseGithubPullRequestEvent("pull_request", {
      action: "closed",
      pull_request: { number: 12, merged: true },
    }),
    { kind: "merged", number: 12 },
  );
  assert.deepEqual(
    parseGithubPullRequestEvent("pull_request", {
      action: "closed",
      pull_request: { number: 12, merged: false },
    }),
    { kind: "closed", number: 12 },
  );
  assert.deepEqual(
    parseGithubPullRequestEvent("pull_request", { action: "opened", pull_request: { number: 1 } }),
    { kind: "ignore" },
  );
  assert.deepEqual(parseGithubPullRequestEvent("ping", {}), { kind: "ignore" });
});

test("parseGithubWebhookEvent maps a successful Build and deploy run", () => {
  assert.deepEqual(
    parseGithubWebhookEvent("workflow_run", {
      action: "completed",
      workflow: { path: ".github/workflows/build-and-deploy.yml", name: "Build and deploy" },
      workflow_run: {
        id: 88,
        name: "Build and deploy",
        conclusion: "success",
        head_branch: "master",
        html_url: "https://github.com/org/game/actions/runs/88",
        display_title: "Bump deployment.json",
        run_started_at: "2026-09-06T18:00:00Z",
        updated_at: "2026-09-06T18:03:20Z",
        head_commit: { message: "Bump deployment.json" },
      },
    }),
    {
      kind: "deployed",
      runId: 88,
      headBranch: "master",
      commitMessage: "Bump deployment.json",
      htmlUrl: "https://github.com/org/game/actions/runs/88",
      durationMinutes: 3,
    },
  );
});

test("parseGithubWebhookEvent maps a failed deploy and ignores other workflows", () => {
  assert.deepEqual(
    parseGithubWebhookEvent("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 9,
        name: "Build and deploy",
        conclusion: "failure",
        head_branch: "master",
        html_url: "https://github.com/org/game/actions/runs/9",
        display_title: "broken",
        run_started_at: "2026-09-06T18:00:00Z",
        updated_at: "2026-09-06T18:01:00Z",
      },
    }),
    {
      kind: "deploy_failed",
      runId: 9,
      headBranch: "master",
      commitMessage: "broken",
      htmlUrl: "https://github.com/org/game/actions/runs/9",
      durationMinutes: 1,
    },
  );
  assert.deepEqual(
    parseGithubWebhookEvent("workflow_run", {
      action: "completed",
      workflow_run: {
        id: 1,
        name: "CI",
        conclusion: "success",
        head_branch: "master",
        html_url: "https://github.com/org/game/actions/runs/1",
      },
    }),
    { kind: "ignore" },
  );
  assert.deepEqual(
    parseGithubWebhookEvent("workflow_run", { action: "in_progress", workflow_run: { id: 1 } }),
    { kind: "ignore" },
  );
});
