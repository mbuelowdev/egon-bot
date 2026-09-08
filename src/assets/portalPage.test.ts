import assert from "node:assert/strict";
import { test } from "node:test";
import { assetPortalPage, portalAsset } from "./portalPage.js";
import type { AssetMeta } from "./store.js";

function asset(overrides: Partial<AssetMeta> & { id: string }): AssetMeta {
  return {
    originalFilename: overrides.id,
    sha256: "sha",
    bytes: 2048,
    kind: "image",
    format: "PNG",
    fileOutput: "PNG image data, 32 x 32, 8-bit/color RGBA, non-interlaced",
    description: "",
    tags: [],
    grid: null,
    parts: [],
    uploadedAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

const TRUCK = asset({
  id: "garbage-truck-orange.glb",
  originalFilename: "a3f9c2d1.glb",
  kind: "model",
  format: "glTF 2.0 binary",
  description: "Orange municipal garbage truck",
  measured: { bboxMeters: [2.1, 1.9, 5.4], triangles: 1240 },
});

/** The page ships its data as a JSON island, which the client reads with JSON.parse. */
function embedded(html: string): Array<Record<string, unknown>> {
  const match = /<script type="application\/json" id="asset-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match?.[1], "asset-data island is missing");
  return JSON.parse(match[1]) as Array<Record<string, unknown>>;
}

test("each asset carries its measured summary and promoted path to the browser", () => {
  const view = portalAsset(TRUCK);
  assert.equal(view.measuredText, "2.1 × 1.9 × 5.4 m, 1.2k tris");
  assert.equal(view.promotedPath, "assets/library/model/garbage-truck-orange.glb");
});

test("the portal ships every asset, described or not, so the gallery can flag the gaps", () => {
  const undescribed = asset({ id: "a3f9c2d1.png" });
  const data = embedded(assetPortalPage([TRUCK, undescribed]));
  assert.deepEqual(
    data.map((item) => item.id),
    ["garbage-truck-orange.glb", "a3f9c2d1.png"],
  );
  assert.equal(data[1]?.description, "");
});

test("a description that closes a script tag cannot break out of the JSON island", () => {
  const hostile = asset({
    id: "grass-plain.png",
    description: '</script><script>alert(1)</script> & "quoted"',
  });
  const html = assetPortalPage([hostile]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.equal(embedded(html)[0]?.description, '</script><script>alert(1)</script> & "quoted"');
});

test("the page carries the drop zone, the undescribed badge, the view toggle, and the dialog", () => {
  const html = assetPortalPage([]);
  assert.match(html, /<title>Egon asset library<\/title>/);
  assert.match(html, /id="drop" class="dropzone"/);
  assert.match(html, /id="undescribed" class="badge warn" hidden/);
  assert.match(html, /data-view="grid"/);
  assert.match(html, /data-view="list"/);
  assert.match(html, /<dialog id="detail">/);
  assert.match(html, /id="description"/);
  assert.match(html, /required/);
  assert.match(html, /id="cell-width"/);
  assert.match(html, /id="cell-height"/);
  assert.match(html, /id="filename"/);
  assert.match(html, /id="replace-hint"/);
  assert.match(html, /id="attach"/);
  assert.match(html, /id="parts"/);
  // 3D preview and the model thumbnail are the browser's job: no xvfb, no server-side render.
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@google\/model-viewer/);
  assert.match(html, /createElement\("model-viewer"\)/);
  assert.match(html, /viewer\.toBlob/);
  assert.ok(
    html.includes(".png .jpg .jpeg .webp .gif .glb .gltf .obj .ogg .wav .mp3 .ttf .otf .woff2"),
    "the accepted list is shown on the drop zone",
  );
});

test("the portal links back to the catalog and never to the external sharing service", () => {
  const html = assetPortalPage([]);
  assert.match(html, /href="\/">Feature log<\/a>/);
  assert.doesNotMatch(html, /discord\.mbuelow\.dev/);
});
