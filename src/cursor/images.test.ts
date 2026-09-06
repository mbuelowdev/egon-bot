import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FeatureStore } from "../features/store.js";
import { agentUserMessage, loadCursorImages, logTextForMessage } from "./images.js";
import { buildImplementerSendMessage } from "./implementer.js";
import { buildPlannerSendMessage } from "./planner.js";
import { featurePaths } from "./testReport.js";

test("logTextForMessage notes image count without embedding bytes", () => {
  assert.equal(logTextForMessage("hello"), "hello");
  assert.equal(logTextForMessage({ text: "see this" }), "see this");
  assert.equal(
    logTextForMessage({ text: "see this", images: [{ data: "abc", mimeType: "image/png" }] }),
    "see this\n(1 image)",
  );
  assert.equal(
    logTextForMessage({
      text: "see these",
      images: [
        { data: "a", mimeType: "image/png" },
        { data: "b", mimeType: "image/jpeg" },
      ],
    }),
    "see these\n(2 images)",
  );
});

test("loadCursorImages encodes stored files as base64", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-cursor-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const dir = featurePaths(dataDir, feature.id).attachmentsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "111.png"), "png-bytes");
  const attachment = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  const images = loadCursorImages(dataDir, feature.id, [attachment]);
  assert.deepEqual(images, [{ data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" }]);
  store.close();
});

test("first planner send includes images; follow-ups stay text-only", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-planner-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  store.addNote(feature.id, "need a HUD");
  const dir = featurePaths(dataDir, feature.id).attachmentsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "111.png"), "png-bytes");
  const attachment = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  const first = buildPlannerSendMessage({
    feature,
    notes: store.listNotes(feature.id),
    attachments: [attachment],
    dataDir,
  });
  assert.equal(typeof first, "object");
  if (typeof first === "string") {
    throw new Error("expected images");
  }
  assert.match(first.text, /need a HUD/);
  assert.match(first.text, /1 Discord image is attached/);
  assert.ok(first.text.includes(dir));
  assert.match(first.text, /assets\/egon\/dash/);
  assert.equal(first.images?.length, 1);
  assert.equal(first.images?.[0]?.mimeType, "image/png");
  const followUp = buildPlannerSendMessage({
    feature,
    notes: store.listNotes(feature.id),
    attachments: [attachment],
    dataDir,
    followUp: "Continue planning.",
  });
  assert.equal(followUp, "Continue planning.");
  store.close();
});

test("first implementer send includes images; follow-ups stay text-only", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const dir = featurePaths(dataDir, feature.id).attachmentsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "111.png"), "png-bytes");
  const attachment = store.addAttachment(feature.id, {
    filename: "sprite.png",
    mimeType: "image/png",
    storedName: "111.png",
  });
  const first = buildImplementerSendMessage({
    feature,
    notes: ["use this sprite"],
    attachments: [attachment],
    dataDir,
  });
  assert.equal(typeof first, "object");
  if (typeof first === "string") {
    throw new Error("expected images");
  }
  assert.match(first.text, /already in the working tree at/);
  assert.match(first.text, /assets\/egon\/dash/);
  assert.equal(first.images?.length, 1);
  const followUp = buildImplementerSendMessage({
    feature,
    notes: ["use this sprite"],
    attachments: [attachment],
    dataDir,
    followUp: "Fix the FAIL report.",
  });
  assert.equal(followUp, "Fix the FAIL report.");
  store.close();
});

test("implementer pivot follow-up attaches the new image", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-impl-pivot-img-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const dir = featurePaths(dataDir, feature.id).attachmentsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "222.png"), "png-bytes");
  const attachment = store.addAttachment(feature.id, {
    filename: "hud.png",
    mimeType: "image/png",
    storedName: "222.png",
  });
  const followUp = buildImplementerSendMessage({
    feature,
    notes: ["match this HUD"],
    attachments: [attachment],
    dataDir,
    followUp: "The humans requested a pivot.\nmatch this HUD",
    followUpAttachments: [attachment],
  });
  assert.equal(typeof followUp, "object");
  if (typeof followUp === "string") {
    throw new Error("expected images");
  }
  assert.match(followUp.text, /requested a pivot/);
  assert.equal(followUp.images?.length, 1);
  assert.equal(followUp.images?.[0]?.mimeType, "image/png");
  store.close();
});

test("agentUserMessage omits images when none exist", () => {
  assert.equal(agentUserMessage("just text", []), "just text");
});
