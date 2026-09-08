import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mimeFor } from "../godot/headers.js";
import {
  SCENE_WARMUP_MS,
  START_PROOF_VIDEO_SOURCE,
  STOP_PROOF_VIDEO_SOURCE,
  startProofVideo,
  stopProofVideo,
} from "./record.js";

test("proof video sources are IIFEs that talk to MediaRecorder", () => {
  assert.match(START_PROOF_VIDEO_SOURCE, /^\(\(\) =>/);
  assert.match(START_PROOF_VIDEO_SOURCE, /captureStream\(30\)/);
  assert.match(START_PROOF_VIDEO_SOURCE, /MediaRecorder/);
  assert.match(STOP_PROOF_VIDEO_SOURCE, /^\(async \(\) =>/);
  assert.match(STOP_PROOF_VIDEO_SOURCE, /btoa\(binary\)/);
});

test("the scene warms up for a second before proof recording", () => {
  assert.equal(SCENE_WARMUP_MS, 1_000);
});

test("startProofVideo treats a failed evaluate as a skipped clip, not a thrown check", async () => {
  assert.equal(await startProofVideo(async () => ({ ok: false, error: "no canvas" })), false);
  assert.equal(await startProofVideo(async () => ({ ok: true })), true);
});

test("stopProofVideo writes decoded bytes when the page returns a clip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-proof-video-"));
  const dest = join(dir, "criterion-1.webm");
  const payload = Buffer.from("webm-bytes".repeat(10));
  const wrote = await stopProofVideo(async () => ({ ok: true, base64: payload.toString("base64") }), dest);
  assert.equal(wrote, true);
  assert.equal(readFileSync(dest, "utf8"), payload.toString("utf8"));
  assert.equal(await stopProofVideo(async () => ({ ok: false, error: "empty" }), dest), false);
});

test("catalog serves proof clips as video/webm", () => {
  assert.equal(mimeFor("criterion-1.webm"), "video/webm");
});
