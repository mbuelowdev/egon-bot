import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.js";
import { parseGithubPullRequestEvent, verifyGithubSignature } from "./webhook.js";

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
