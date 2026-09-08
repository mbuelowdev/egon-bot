import assert from "node:assert/strict";
import { test } from "node:test";
import { claudeQueryProducedWork } from "./stream.js";

test("init and rate-limit events are not produced work", () => {
  assert.equal(
    claudeQueryProducedWork({ type: "system", subtype: "init", session_id: "sess-1" }),
    false,
  );
  assert.equal(
    claudeQueryProducedWork({
      type: "rate_limit_event",
      session_id: "sess-1",
      rate_limit_info: { status: "rejected" },
    }),
    false,
  );
  assert.equal(claudeQueryProducedWork({ type: "stream_event", session_id: "sess-1" }), false);
  assert.equal(claudeQueryProducedWork({ type: "result", is_error: true, session_id: "sess-1" }), false);
});

test("assistant and user turns count as produced work", () => {
  assert.equal(claudeQueryProducedWork({ type: "assistant", session_id: "sess-1" }), true);
  assert.equal(claudeQueryProducedWork({ type: "user", session_id: "sess-1" }), true);
});
