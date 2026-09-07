import assert from "node:assert/strict";
import { test } from "node:test";
import {
  looksLikeClaudeUsageLimit,
  shouldFallbackToCursorPlanner,
} from "./usageLimit.js";

test("looksLikeClaudeUsageLimit matches spend cap and billing", () => {
  assert.equal(
    looksLikeClaudeUsageLimit({
      status: 429,
      type: "rate_limit_error",
      message: "You have reached your API usage limits: monthly API usage threshold",
      error: { details: { error_code: "enforced_spend_limit_reached" } },
    }),
    true,
  );
  assert.equal(
    looksLikeClaudeUsageLimit({
      status: 400,
      message: "You have reached your specified API usage limits",
    }),
    true,
  );
  assert.equal(looksLikeClaudeUsageLimit({ status: 402, type: "billing_error" }), true);
  assert.equal(looksLikeClaudeUsageLimit({ assistantError: "billing_error" }), true);
  assert.equal(looksLikeClaudeUsageLimit({ rateLimitStatus: "rejected" }), true);
});

test("looksLikeClaudeUsageLimit ignores auth, overload, and transient 429", () => {
  assert.equal(looksLikeClaudeUsageLimit({ assistantError: "authentication_failed" }), false);
  assert.equal(looksLikeClaudeUsageLimit({ assistantError: "overloaded" }), false);
  assert.equal(
    looksLikeClaudeUsageLimit({
      status: 429,
      type: "rate_limit_error",
      message: "This request would exceed your organization's rate limit",
      "retry-after": 30,
    }),
    false,
  );
  assert.equal(looksLikeClaudeUsageLimit(new Error("PLAN_BLOCKED")), false);
});

test("shouldFallbackToCursorPlanner only when usage limit and this query never started", () => {
  assert.equal(
    shouldFallbackToCursorPlanner({
      plannerBackend: null,
      usageLimit: true,
      startedThisQuery: false,
    }),
    true,
  );
  assert.equal(
    shouldFallbackToCursorPlanner({
      plannerBackend: "claude",
      usageLimit: true,
      startedThisQuery: true,
    }),
    false,
  );
  assert.equal(
    shouldFallbackToCursorPlanner({
      plannerBackend: "claude",
      usageLimit: true,
      startedThisQuery: false,
    }),
    true,
  );
  assert.equal(
    shouldFallbackToCursorPlanner({
      plannerBackend: "cursor",
      usageLimit: true,
      startedThisQuery: false,
    }),
    false,
  );
  assert.equal(
    shouldFallbackToCursorPlanner({
      plannerBackend: null,
      usageLimit: false,
      startedThisQuery: false,
    }),
    false,
  );
});
