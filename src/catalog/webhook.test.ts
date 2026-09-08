import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { decorateHexColors, renderMarkdown } from "./markdown.js";
import { parseGithubPullRequestEvent, parseGithubWebhookEvent, verifyGithubSignature } from "./webhook.js";

test("renderMarkdown renders plain-language acceptance criteria as an ordered list", () => {
  const html = renderMarkdown(
    [
      "## 8. Acceptance criteria",
      "",
      "Definition of done.",
      "",
      "1. The player dashes 80 pixels right when Space is tapped.",
      "2. The HUD shows the remaining dash charges.",
    ].join("\n"),
  );
  assert.match(html, /<ol>/);
  assert.match(html, /<li>The player dashes 80 pixels right when Space is tapped\.<\/li>/);
  assert.match(html, /<li>The HUD shows the remaining dash charges\.<\/li>/);
  assert.match(html, /<p>Definition of done\.<\/p>/);
  // The executable steps moved to the checks file, so no criterion table remains.
  assert.doesNotMatch(html, /<table class="criteria">/);
});

test("renderMarkdown still uses a numbered list for prose criteria", () => {
  const html = renderMarkdown("# Title\n\n**Acceptance criteria**\n\n1. Click play\n2. See HUD\n");
  assert.match(html, /<li>Click play<\/li>/);
  assert.match(html, /<li>See HUD<\/li>/);
  assert.doesNotMatch(html, /<table class="criteria">/);
});

test("renderMarkdown turns dash and star bullets into an unordered list", () => {
  const html = renderMarkdown("### In scope\n\n- Dash action\n* HUD charge counter\n+ Keep existing jump\n");
  assert.match(html, /<ul>/);
  assert.match(html, /<li>Dash action<\/li>/);
  assert.match(html, /<li>HUD charge counter<\/li>/);
  assert.match(html, /<li>Keep existing jump<\/li>/);
  assert.doesNotMatch(html, /<p>Dash action<\/p>/);
});

test("renderMarkdown escapes HTML", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("renderMarkdown turns fenced code into a pre/code block", () => {
  const html = renderMarkdown("See:\n\n```gdscript\nfunc _ready():\n\tprint(\"hi\")\n```\n\nDone.");
  assert.match(html, /<p>See:<\/p>/);
  assert.match(html, /<pre><code class="language-gdscript">func _ready\(\):\n\tprint\(&quot;hi&quot;\)<\/code><\/pre>/);
  assert.match(html, /<p>Done\.<\/p>/);
  assert.doesNotMatch(html, /```/);
});

test("renderMarkdown does not apply inline markdown inside fenced code", () => {
  const html = renderMarkdown("```\n**bold** and `tick`\n```");
  assert.match(html, /<pre><code>\*\*bold\*\* and `tick`<\/code><\/pre>/);
  assert.doesNotMatch(html, /<strong>/);
});

test("renderMarkdown keeps an unclosed fence as a code block", () => {
  const html = renderMarkdown("```js\nconst x = 1;");
  assert.match(html, /<pre><code class="language-js">const x = 1;<\/code><\/pre>/);
});

test("renderMarkdown wraps major spec headings as collapsed details", () => {
  const html = renderMarkdown(
    [
      "# Dash",
      "",
      "## 1. Context & Goal",
      "",
      "Dash across gaps.",
      "",
      "## 2. Scope",
      "",
      "### In scope",
      "",
      "- Dash action",
      "",
      "## 3. Relevant files / existing code",
      "",
      "player.gd",
      "",
      "## 4. Interface / Contract",
      "",
      "API shape",
      "",
      "## 5. Implementation notes / constraints",
      "",
      "Stay on web export.",
    ].join("\n"),
    { collapsibleSections: true, skipLeadingH1: true },
  );
  assert.doesNotMatch(html, /<h1>/);
  assert.match(html, /<details class="spec-section" open>\n<summary><h2>1\. Context &amp; Goal<\/h2><\/summary>/);
  assert.match(html, /<p>Dash across gaps\.<\/p>/);
  assert.match(html, /<details class="spec-section">\n<summary><h2>2\. Scope<\/h2><\/summary>/);
  assert.match(html, /<h3>In scope<\/h3>/);
  assert.match(html, /<summary><h2>3\. Relevant files \/ existing code<\/h2><\/summary>/);
  assert.match(html, /<summary><h2>4\. Interface \/ Contract<\/h2><\/summary>/);
  assert.match(html, /<summary><h2>5\. Implementation notes \/ constraints<\/h2><\/summary>/);
  assert.equal([...html.matchAll(/<details class="spec-section" open>/g)].length, 1);
  assert.equal([...html.matchAll(/<details class="spec-section">/g)].length, 4);
});

test("renderMarkdown still renders a leading h1 without skipLeadingH1", () => {
  const html = renderMarkdown("# Title\n\nHello");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>Hello<\/p>/);
});

test("renderMarkdown leaves h2 headings in place without collapsibleSections", () => {
  const html = renderMarkdown("## 2. Scope\n\nHello");
  assert.match(html, /<h2>2\. Scope<\/h2>/);
  assert.doesNotMatch(html, /<details/);
});

test("renderMarkdown turns pipe tables into HTML tables", () => {
  const html = renderMarkdown(
    [
      "| node | center | radius | color |",
      "|---------|------------|--------|-----------|",
      "| Blob1 | (1200, 700) | 160 | #155E54 dark teal |",
      "| Blob2 | (1650, 680) | 140 | #3D9B8C light teal |",
    ].join("\n"),
  );
  assert.match(html, /<div class="md-table-wrap"><table class="md">/);
  assert.match(html, /<thead><tr><th>node<\/th><th>center<\/th><th>radius<\/th><th>color<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>Blob1<\/td><td>\(1200, 700\)<\/td><td>160<\/td>/);
  assert.match(
    html,
    /#155E54<span class="color-dot" style="background:#155E54" aria-hidden="true"><\/span> dark teal/,
  );
  assert.doesNotMatch(html, /<p>\| node/);
});

test("renderMarkdown honors table column alignment", () => {
  const html = renderMarkdown("| left | mid | right |\n|:---|:---:|---:|\n| a | b | c |");
  assert.match(html, /<th>left<\/th><th style="text-align:center">mid<\/th><th style="text-align:right">right<\/th>/);
  assert.match(html, /<td>a<\/td><td style="text-align:center">b<\/td><td style="text-align:right">c<\/td>/);
});

test("renderMarkdown leaves a lone pipe line as a paragraph", () => {
  const html = renderMarkdown("| not a table |");
  assert.match(html, /<p>\| not a table \|<\/p>/);
  assert.doesNotMatch(html, /<table/);
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

test("parseGithubWebhookEvent accepts a string run id", () => {
  assert.deepEqual(
    parseGithubWebhookEvent("workflow_run", {
      action: "completed",
      workflow: { name: "Build and deploy" },
      workflow_run: {
        id: "88",
        path: ".github/workflows/build-and-deploy.yml",
        conclusion: "success",
        head_branch: "master",
        html_url: "https://github.com/org/game/actions/runs/88",
        display_title: "Bump deployment.json",
      },
    }),
    {
      kind: "deployed",
      runId: 88,
      headBranch: "master",
      commitMessage: "Bump deployment.json",
      htmlUrl: "https://github.com/org/game/actions/runs/88",
      durationMinutes: 1,
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
