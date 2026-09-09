import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_MANIFEST_ASSETS,
  assetIndexPromptSection,
  assetManifestPath,
  declaredAssetsPromptSection,
  generateAssetManifest,
  measuredSummary,
  renderAssetManifest,
  writeAssetManifest,
} from "./manifest.js";
import type { AssetMeta } from "./store.js";

function asset(overrides: Partial<AssetMeta> & { id: string }): AssetMeta {
  return {
    originalFilename: overrides.id,
    sha256: "sha",
    bytes: 1024,
    kind: "image",
    format: "PNG",
    fileOutput: "",
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
  kind: "model",
  format: "glTF 2.0 binary",
  description: "Orange municipal garbage truck, low-poly flat-shaded, wheels are separate nodes",
  measured: { bboxMeters: [2.1, 1.9, 5.4], triangles: 1240, animations: ["wheels_spin"] },
});

const GRASS = asset({
  id: "grass-plain.png",
  description: "Top-down seamless grass tile, 4-colour palette",
  measured: { width: 32, height: 32, colorType: "RGBA" },
});

const HERO = asset({
  id: "hero-walk.png",
  description: "Hero walk cycle, rows are down/up/left/right",
  grid: { cellWidth: 32, cellHeight: 32 },
  measured: {
    width: 512,
    height: 256,
    colorType: "RGBA",
    grid: { cellWidth: 32, cellHeight: 32, columns: 16, rows: 8, frames: 128 },
  },
});

const HIT = asset({
  id: "hit.ogg",
  kind: "audio",
  format: "Ogg Vorbis",
  description: "Short metallic impact",
  measured: { durationSeconds: 0.42, sampleRate: 44100, channels: 2 },
});

test("the measured column reads the way a human would write it", () => {
  assert.equal(measuredSummary(TRUCK), "2.1 × 1.9 × 5.4 m, 1.2k tris, anims: wheels_spin");
  assert.equal(measuredSummary(GRASS), "32 × 32 RGBA");
  assert.equal(measuredSummary(HERO), "512 × 256 RGBA, grid 32 × 32 (16 × 8 = 128 frames)");
  assert.equal(measuredSummary(HIT), "0.42 s, 44.1 kHz stereo");
  assert.equal(measuredSummary(asset({ id: "ui.ttf", kind: "font" })), "");
});

test("the manifest groups by kind and carries measured facts and descriptions", () => {
  const markdown = renderAssetManifest([TRUCK, GRASS, HERO, HIT]);
  assert.match(markdown, /^# Asset library$/m);
  assert.match(markdown, /^## Models$/m);
  assert.match(markdown, /^## Images$/m);
  assert.match(markdown, /^## Audio$/m);
  assert.match(markdown, /\| `garbage-truck-orange\.glb` \| 2\.1 × 1\.9 × 5\.4 m, 1\.2k tris, anims: wheels_spin \|/);
  assert.match(markdown, /\| `hero-walk\.png` \| 512 × 256 RGBA, grid 32 × 32 \(16 × 8 = 128 frames\) \|/);
  assert.match(markdown, /after promotion the path is `assets\/images\/\{id\}`/);
  assert.match(markdown, /`assets\/models\/\{id\}`/);
  assert.match(markdown, /`assets\/audio\/\{id\}`/);
  assert.match(markdown, /`assets\/fonts\/\{id\}`/);
});

test("an asset with no description is absent from the manifest entirely", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-manifest-"));
  const markdown = renderAssetManifest([GRASS]);
  assert.match(markdown, /grass-plain\.png/);
  assert.doesNotMatch(renderAssetManifest([]), /grass-plain/);
  assert.match(renderAssetManifest([]), /The library is empty/);
  writeAssetManifest(dir);
  assert.equal(readFileSync(assetManifestPath(dir), "utf8"), generateAssetManifest(dir));
  assert.match(readFileSync(assetManifestPath(dir), "utf8"), /The library is empty/);
});

test("the manifest caps at MAX_MANIFEST_ASSETS with a … N more row", () => {
  const many = Array.from({ length: MAX_MANIFEST_ASSETS + 7 }, (_, i) =>
    asset({ id: `tile-${String(i).padStart(4, "0")}.png`, description: `Tile ${String(i)}` }),
  );
  const markdown = renderAssetManifest(many);
  assert.match(markdown, /\| … \| 7 more \| \|/);
  const rows = markdown.split("\n").filter((line) => line.startsWith("| `")).length;
  assert.equal(rows, MAX_MANIFEST_ASSETS);
});

test("the planner's index lists every described asset and carries no measured column", () => {
  const lines = assetIndexPromptSection([TRUCK, GRASS, HERO, HIT]).join("\n");
  assert.match(lines, /- `garbage-truck-orange\.glb` — Orange municipal garbage truck/);
  assert.match(lines, /- `grass-plain\.png` — Top-down seamless grass tile/);
  assert.match(lines, /- `hit\.ogg` — Short metallic impact/);
  assert.doesNotMatch(lines, /2\.1 × 1\.9 × 5\.4/);
  assert.doesNotMatch(lines, /1\.2k tris/);
  assert.doesNotMatch(lines, /128 frames/);
  assert.match(lines, /do not invent one/);
  assert.match(lines, /`assets\/images\/\{id\}`/);
  assert.match(lines, /`assets\/models\/\{id\}`/);
});

test("an empty library still tells the planner to write None.", () => {
  const lines = assetIndexPromptSection([]).join("\n");
  assert.match(lines, /the library is empty/);
  assert.match(lines, /write `None\.`/);
});

test("the implementer's section carries measurements for exactly its spec's ids", () => {
  const lines = declaredAssetsPromptSection(
    ["garbage-truck-orange.glb", "hero-walk.png"],
    [TRUCK, GRASS, HERO, HIT],
  ).join("\n");
  assert.match(lines, /`garbage-truck-orange\.glb` \| 2\.1 × 1\.9 × 5\.4 m/);
  assert.match(lines, /`assets\/models\/garbage-truck-orange\.glb`/);
  assert.match(lines, /`assets\/images\/hero-walk\.png`/);
  assert.match(lines, /`hero-walk\.png` \| 512 × 256 RGBA, grid 32 × 32 \(16 × 8 = 128 frames\)/);
  assert.doesNotMatch(lines, /grass-plain/);
  assert.doesNotMatch(lines, /hit\.ogg/);
  assert.match(lines, /do not reference any other library asset/);
});

test("companion files appear in a Ships with column and in the implementer's table", () => {
  const truck = asset({
    ...TRUCK,
    parts: [
      { filename: "truck-diffuse.png", sha256: "a", bytes: 12, uploadedAt: TRUCK.uploadedAt },
      { filename: "truck.bin", sha256: "b", bytes: 8, uploadedAt: TRUCK.uploadedAt },
    ],
  });
  const markdown = renderAssetManifest([truck, GRASS]);
  assert.match(markdown, /\| id \| Measured \| Ships with \| Description \|/);
  assert.match(markdown, /\| `garbage-truck-orange\.glb` \| .* \| `truck-diffuse\.png`, `truck\.bin` \|/);
  assert.match(markdown, /\| `grass-plain\.png` \| .* \| — \|/);

  const lines = declaredAssetsPromptSection(["garbage-truck-orange.glb"], [truck, GRASS]).join("\n");
  assert.match(lines, /\| id \| Measured \| Ships with \| Path in this repo \|/);
  assert.match(lines, /`truck-diffuse\.png`, `truck\.bin`/);
  assert.match(lines, /companion files sit in the same directory/);
});

test("a spec that declares no assets gets no implementer section at all", () => {
  assert.deepEqual(declaredAssetsPromptSection([], [TRUCK]), []);
  assert.deepEqual(declaredAssetsPromptSection(["not-in-library.glb"], [TRUCK]), []);
});

test("sprite cell groups appear in the manifest and implementer slice only when present", () => {
  const sheet = asset({
    ...HERO,
    cellGroups: [
      {
        description: "flower variants",
        cells: [
          { col: 2, row: 0 },
          { col: 3, row: 0 },
          { col: 4, row: 0 },
        ],
      },
    ],
  });
  const markdown = renderAssetManifest([sheet, GRASS]);
  assert.match(
    markdown,
    /Hero walk cycle, rows are down\/up\/left\/right Regions: flower variants \(row 0, cols 2–4\)/,
  );
  assert.doesNotMatch(markdown, /grass-plain\.png` \| .*Regions:/);

  const index = assetIndexPromptSection([sheet, GRASS]).join("\n");
  assert.match(index, /flower variants \(row 0, cols 2–4\)/);
  assert.match(index, /- `grass-plain\.png` — Top-down seamless grass tile, 4-colour palette$/m);

  const lines = declaredAssetsPromptSection(["hero-walk.png", "grass-plain.png"], [sheet, GRASS]).join("\n");
  assert.match(lines, /`hero-walk\.png` regions \(0-based col, row; cell 32×32\):/);
  assert.match(lines, /- flower variants: \(2,0\)–\(4,0\)/);
  assert.match(lines, /col × cell width/);
  assert.doesNotMatch(lines, /grass-plain\.png` regions/);
});
