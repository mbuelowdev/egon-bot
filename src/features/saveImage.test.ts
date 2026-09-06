import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { featurePaths } from "../cursor/testReport.js";
import { assertImageContentType, saveFeatureImage } from "./saveImage.js";
import { FeatureStore, UserFacingError } from "./store.js";

test("assertImageContentType allows raster images and rejects others", () => {
  assert.equal(assertImageContentType("image/png"), "image/png");
  assert.equal(assertImageContentType("image/jpeg; charset=binary"), "image/jpeg");
  assert.equal(assertImageContentType("image/jpg"), "image/jpeg");
  assert.throws(() => assertImageContentType(null), UserFacingError);
  assert.throws(() => assertImageContentType("application/pdf"), UserFacingError);
  assert.throws(() => assertImageContentType("image/svg+xml"), UserFacingError);
});

test("saveFeatureImage downloads bytes and records metadata", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-image-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  const saved = await saveFeatureImage(
    {
      dataDir,
      store,
      featureId: feature.id,
      image: { name: "HUD Mock.png", url: "https://cdn.example/hud.png", contentType: "image/png" },
    },
    async (url) => {
      assert.equal(url, "https://cdn.example/hud.png");
      return new Response(Buffer.from("png-bytes"), { status: 200 });
    },
  );
  assert.equal(saved.filename, "HUD Mock.png");
  assert.equal(saved.mimeType, "image/png");
  assert.match(saved.storedName, /\.png$/);
  const filePath = join(featurePaths(dataDir, feature.id).attachmentsDir, saved.storedName);
  assert.equal(existsSync(filePath), true);
  assert.equal(readFileSync(filePath, "utf8"), "png-bytes");
  assert.equal(store.listAttachments(feature.id).length, 1);
  store.close();
});

test("saveFeatureImage rejects a failed download", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "egon-image-fail-"));
  const store = new FeatureStore(":memory:");
  const feature = store.createFeature("dash", "channel-1");
  await assert.rejects(
    () =>
      saveFeatureImage(
        {
          dataDir,
          store,
          featureId: feature.id,
          image: { name: "hud.png", url: "https://cdn.example/hud.png", contentType: "image/png" },
        },
        async () => new Response("nope", { status: 404 }),
      ),
    /Could not download/,
  );
  assert.equal(store.listAttachments(feature.id).length, 0);
  store.close();
});
