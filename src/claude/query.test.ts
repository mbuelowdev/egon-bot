import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config.js";
import { buildClaudeUserPrompt, envForClaude } from "./query.js";

test("first Claude planner turn uses image blocks; text-only stays a string", async () => {
  assert.equal(buildClaudeUserPrompt("Continue the plan.", []), "Continue the plan.");
  const streamed = buildClaudeUserPrompt("Ground this spec.", [
    { data: "abc", mimeType: "image/png" },
  ]);
  assert.notEqual(typeof streamed, "string");
  const messages: SDKUserMessage[] = [];
  for await (const message of streamed as AsyncIterable<SDKUserMessage>) {
    messages.push(message);
  }
  assert.equal(messages.length, 1);
  const content = messages[0]?.message.content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0] && typeof content[0] === "object" ? content[0].type : undefined, "text");
  assert.deepEqual(content[0], { type: "text", text: "Ground this spec." });
  assert.equal(content[1] && typeof content[1] === "object" ? content[1].type : undefined, "image");
});

test("envForClaude uses the OAuth token and strips inherited API credentials", () => {
  const env = envForClaude({
    claudeCodeOAuthToken: "oat-token",
    dataDir: "/data",
  } as Config);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "oat-token");
  assert.equal("ANTHROPIC_API_KEY" in env, false);
  assert.equal("ANTHROPIC_AUTH_TOKEN" in env, false);
});
