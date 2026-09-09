import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DetectedAsset } from "./detect.js";
import {
  assetFilePath,
  assetIdFor,
  assetNameFromDescription,
  assetPartsDir,
  attachAssetPart,
  detachAssetPart,
  partFilePath,
  readAssetMeta,
  renameAssetId,
  replaceAssetBytes,
  deleteAsset,
  describedAssets,
  descriptionFromFilename,
  findAssetBySha,
  isSafeAssetId,
  listAssets,
  promotedAssetPath,
  saveAsset,
  saveThumbnail,
  sidecarPath,
  slugifyAssetName,
  thumbFilePath,
  updateAsset,
  formatCellGroupCells,
  formatCellGroupCoords,
  formatCellGroups,
  normalizeCellGroups,
} from "./store.js";

function dataDir(): string {
  return mkdtempSync(join(tmpdir(), "egon-assets-"));
}

const MODEL: DetectedAsset = {
  kind: "model",
  ext: ".glb",
  format: "glTF 2.0 binary",
  fileOutput: "glTF binary model, version 2",
  mimeType: "model/gltf-binary",
  measured: { bboxMeters: [2.1, 1.9, 5.4], triangles: 1240 },
};

const SHEET: DetectedAsset = {
  kind: "image",
  ext: ".png",
  format: "PNG",
  fileOutput: "PNG image data, 512 x 256, 8-bit/color RGBA, non-interlaced",
  mimeType: "image/png",
  measured: { width: 512, height: 256, colorType: "RGBA" },
};

test("ids never escape the library directory", () => {
  const dir = dataDir();
  for (const id of ["../secret.png", "a/b.png", "a\\b.png", "..", "", ".hidden/../x"]) {
    assert.equal(isSafeAssetId(id), false, `${id} should be unsafe`);
    assert.equal(assetFilePath(dir, id), undefined);
    assert.equal(sidecarPath(dir, id), undefined);
    assert.equal(thumbFilePath(dir, id), undefined);
  }
  assert.equal(isSafeAssetId("garbage-truck-orange.glb"), true);
  assert.ok(assetFilePath(dir, "garbage-truck-orange.glb")?.endsWith("/assets/garbage-truck-orange.glb"));
});

test("a traversal id is refused on read, write, and delete", () => {
  const dir = dataDir();
  assert.equal(updateAsset(dir, "../escape.png", { description: "nope" }), undefined);
  assert.equal(deleteAsset(dir, "../escape.png"), false);
  assert.equal(saveThumbnail(dir, "../escape.png", Buffer.from("x")), false);
});

test("the id slugs the description and collides with a -2 suffix", () => {
  assert.equal(slugifyAssetName("Orange Garbage Truck!"), "orange-garbage-truck");
  assert.equal(descriptionFromFilename("garbage_truck_orange.glb"), "garbage truck orange");
  assert.equal(
    assetIdFor({ description: "Garbage truck orange", originalFilename: "a3f9.glb", ext: ".glb", taken: [] }),
    "garbage-truck-orange.glb",
  );
  // The id is a filename someone reads in a res:// path; prose belongs in the description.
  assert.equal(assetNameFromDescription("Orange garbage truck, wheels are separate nodes"), "orange-garbage-truck");
  assert.equal(assetNameFromDescription("Hero walk cycle. Rows are down/up/left/right"), "hero-walk-cycle");
  assert.equal(assetNameFromDescription(", , ,"), "");
  assert.equal(
    assetIdFor({
      description: "Garbage truck orange",
      originalFilename: "a3f9.glb",
      ext: ".glb",
      taken: ["garbage-truck-orange.glb"],
    }),
    "garbage-truck-orange-2.glb",
  );
  assert.equal(
    assetIdFor({ description: "", originalFilename: "hero_walk.png", ext: ".png", taken: [] }),
    "hero-walk.png",
  );
  assert.equal(
    assetIdFor({ description: "", originalFilename: "!!!.png", ext: ".png", taken: [] }),
    "asset.png",
  );
});

test("the id comes from the description at first save and never changes again", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb-bytes"),
    originalFilename: "a3f9c2d1.glb",
    detected: MODEL,
  });
  assert.equal(saved.id, "a3f9c2d1.glb");
  assert.equal(saved.description, "");

  const described = updateAsset(dir, saved.id, { description: "Orange municipal garbage truck" });
  assert.equal(described?.id, "orange-municipal-garbage-truck.glb");
  assert.equal(existsSync(assetFilePath(dir, "orange-municipal-garbage-truck.glb") as string), true);
  assert.equal(existsSync(assetFilePath(dir, "a3f9c2d1.glb") as string), false);
  assert.equal(described?.originalFilename, "a3f9c2d1.glb");

  const edited = updateAsset(dir, described?.id as string, {
    description: "Orange municipal garbage truck, wheels are separate nodes",
  });
  assert.equal(edited?.id, "orange-municipal-garbage-truck.glb");
  assert.equal(
    readFileSync(assetFilePath(dir, "orange-municipal-garbage-truck.glb") as string, "utf8"),
    "glb-bytes",
  );
  assert.equal(promotedAssetPath(edited as { id: string; kind: "model" }), "assets/library/model/orange-municipal-garbage-truck.glb");
});

test("an undescribed asset is in the library but invisible to agents", () => {
  const dir = dataDir();
  saveAsset({ dataDir: dir, buffer: Buffer.from("a"), originalFilename: "one.png", detected: SHEET });
  const two = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("b"),
    originalFilename: "two.png",
    detected: SHEET,
  });
  updateAsset(dir, two.id, { description: "Top-down grass tile" });
  assert.equal(listAssets(dir).length, 2);
  assert.deepEqual(
    describedAssets(dir).map((meta) => meta.id),
    ["top-down-grass-tile.png"],
  );
});

test("re-uploading identical bytes under a new name resolves to the existing asset", () => {
  const dir = dataDir();
  const bytes = Buffer.from("identical-bytes");
  const first = saveAsset({
    dataDir: dir,
    buffer: bytes,
    originalFilename: "grass_plain.png",
    detected: SHEET,
  });
  const found = findAssetBySha(dir, first.sha256);
  assert.equal(found?.id, first.id);
  assert.equal(findAssetBySha(dir, "0".repeat(64)), undefined);
});

test("a grid spec derives columns, rows, and frames on every save", () => {
  const dir = dataDir();
  const sheet = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("sheet"),
    originalFilename: "hero_walk.png",
    detected: SHEET,
  });
  const gridded = updateAsset(dir, sheet.id, {
    description: "Hero walk cycle",
    grid: { cellWidth: 32, cellHeight: 32 },
  });
  assert.deepEqual(gridded?.measured?.grid, {
    cellWidth: 32,
    cellHeight: 32,
    columns: 16,
    rows: 8,
    frames: 128,
  });
  const cleared = updateAsset(dir, gridded?.id as string, { grid: null });
  assert.equal(cleared?.measured?.grid, undefined);
  assert.equal(cleared?.measured?.width, 512);
});

test("cell groups persist, prune out of bounds, and stay off unlabeled sidecars", () => {
  const dir = dataDir();
  const sheet = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("sheet"),
    originalFilename: "hero_walk.png",
    detected: SHEET,
  });
  const sidecar = sidecarPath(dir, sheet.id) as string;
  assert.equal("cellGroups" in JSON.parse(readFileSync(sidecar, "utf8")), false);

  const labeled = updateAsset(dir, sheet.id, {
    description: "Hero sprites",
    grid: { cellWidth: 32, cellHeight: 32 },
    cellGroups: [
      {
        description: "  flower variants ",
        cells: [
          { col: 2, row: 0 },
          { col: 2, row: 0 },
          { col: 4, row: 0 },
          { col: 3, row: 0 },
          { col: 99, row: 0 },
          { col: -1, row: 0 },
        ],
      },
      { description: "", cells: [{ col: 0, row: 0 }] },
      { description: "empty", cells: [] },
    ],
  });
  assert.deepEqual(labeled?.cellGroups, [
    {
      description: "flower variants",
      cells: [
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 0 },
      ],
    },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(sidecarPath(dir, labeled?.id as string) as string, "utf8")).cellGroups, [
    {
      description: "flower variants",
      cells: [
        { col: 2, row: 0 },
        { col: 3, row: 0 },
        { col: 4, row: 0 },
      ],
    },
  ]);

  const kept = updateAsset(dir, labeled?.id as string, { description: "Hero sprites, idle and walk" });
  assert.deepEqual(kept?.cellGroups, labeled?.cellGroups);

  const clearedGroups = updateAsset(dir, kept?.id as string, { cellGroups: [] });
  assert.equal(clearedGroups?.cellGroups, undefined);
  assert.equal("cellGroups" in JSON.parse(readFileSync(sidecarPath(dir, kept?.id as string) as string, "utf8")), false);

  const again = updateAsset(dir, kept?.id as string, {
    grid: { cellWidth: 32, cellHeight: 32 },
    cellGroups: [{ description: "walk down", cells: [{ col: 0, row: 1 }] }],
  });
  const noGrid = updateAsset(dir, again?.id as string, { grid: null });
  assert.equal(noGrid?.cellGroups, undefined);
});

test("an old sidecar without cellGroups still loads", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("sheet"),
    originalFilename: "grass.png",
    detected: SHEET,
    description: "Grass tile",
  });
  const path = sidecarPath(dir, saved.id) as string;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete raw.cellGroups;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  const loaded = readAssetMeta(dir, saved.id);
  assert.equal(loaded?.cellGroups, undefined);
  assert.equal(loaded?.description, "Grass tile");
});

test("cell group formatting collapses consecutive columns", () => {
  const cells = [
    { col: 2, row: 0 },
    { col: 3, row: 0 },
    { col: 4, row: 0 },
    { col: 0, row: 1 },
  ];
  assert.equal(formatCellGroupCells(cells), "row 0, cols 2–4; row 1, col 0");
  assert.equal(formatCellGroupCoords(cells), "(2,0)–(4,0), (0,1)");
  assert.equal(
    formatCellGroups([{ description: "flower variants", cells }]),
    "flower variants (row 0, cols 2–4; row 1, col 0)",
  );
  assert.equal(formatCellGroups(undefined), "");
  assert.equal(formatCellGroups([]), "");
  assert.deepEqual(normalizeCellGroups("nope"), []);
});

test("delete removes the asset, its sidecar, and its thumbnail", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb"),
    originalFilename: "truck.glb",
    detected: MODEL,
  });
  saveThumbnail(dir, saved.id, Buffer.from("png"));
  assert.equal(existsSync(thumbFilePath(dir, saved.id) as string), true);
  assert.equal(deleteAsset(dir, saved.id), true);
  assert.equal(existsSync(assetFilePath(dir, saved.id) as string), false);
  assert.equal(existsSync(sidecarPath(dir, saved.id) as string), false);
  assert.equal(existsSync(thumbFilePath(dir, saved.id) as string), false);
  assert.equal(deleteAsset(dir, saved.id), false);
  assert.deepEqual(listAssets(dir), []);
});

test("tags are normalised and an empty library lists nothing", () => {
  const dir = dataDir();
  assert.deepEqual(listAssets(dir), []);
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb"),
    originalFilename: "truck.glb",
    detected: MODEL,
    tags: ["Vehicle", " vehicle ", "level 3", ""],
  });
  assert.deepEqual(saved.tags, ["vehicle", "level-3"]);
});

test("a human rename moves the file, the sidecar, the thumbnail, and the companions", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb-bytes"),
    originalFilename: "truck.glb",
    detected: MODEL,
  });
  updateAsset(dir, saved.id, { description: "Garbage truck" });
  saveThumbnail(dir, "garbage-truck.glb", Buffer.from("png"));
  attachAssetPart({ dataDir: dir, id: "garbage-truck.glb", filename: "truck.bin", buffer: Buffer.from("bin") });

  const renamed = renameAssetId(dir, "garbage-truck.glb", "Orange Truck");
  assert.equal(renamed.ok, true);
  if (!renamed.ok) {
    return;
  }
  assert.equal(renamed.meta.id, "orange-truck.glb");
  assert.equal(readFileSync(assetFilePath(dir, "orange-truck.glb") as string, "utf8"), "glb-bytes");
  assert.equal(existsSync(assetFilePath(dir, "garbage-truck.glb") as string), false);
  assert.equal(existsSync(sidecarPath(dir, "garbage-truck.glb") as string), false);
  assert.equal(existsSync(thumbFilePath(dir, "orange-truck.glb") as string), true);
  assert.equal(
    readFileSync(partFilePath(dir, "orange-truck.glb", "truck.bin") as string, "utf8"),
    "bin",
  );
  assert.deepEqual(renamed.meta.parts.map((part) => part.filename), ["truck.bin"]);
  assert.equal(renamed.meta.description, "Garbage truck");
  assert.equal(listAssets(dir).length, 1);
});

test("a rename onto an id that already exists is refused", () => {
  const dir = dataDir();
  const one = saveAsset({ dataDir: dir, buffer: Buffer.from("a"), originalFilename: "one.glb", detected: MODEL });
  const two = saveAsset({ dataDir: dir, buffer: Buffer.from("b"), originalFilename: "two.glb", detected: MODEL });
  const clash = renameAssetId(dir, two.id, "one");
  assert.equal(clash.ok, false);
  if (!clash.ok) {
    assert.match(clash.reason, /already in the library/);
  }
  assert.equal(readAssetMeta(dir, one.id)?.id, "one.glb");
  assert.equal(readAssetMeta(dir, two.id)?.id, "two.glb");

  const empty = renameAssetId(dir, two.id, "   ");
  assert.equal(empty.ok, false);
  // Renaming to the name it already has is a no-op, not an error.
  const same = renameAssetId(dir, two.id, "two");
  assert.equal(same.ok, true);
});

test("replacing an asset swaps the bytes and re-measures but keeps what a human typed", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("old-sheet"),
    originalFilename: "hero.png",
    detected: SHEET,
  });
  updateAsset(dir, saved.id, {
    description: "Hero walk cycle",
    tags: ["hero"],
    grid: { cellWidth: 32, cellHeight: 32 },
    cellGroups: [
      { description: "flower variants", cells: [{ col: 2, row: 0 }, { col: 15, row: 0 }, { col: 0, row: 7 }] },
    ],
  });
  const replaced = replaceAssetBytes({
    dataDir: dir,
    id: "hero-walk-cycle.png",
    buffer: Buffer.from("new-sheet-bytes"),
    originalFilename: "hero_v2.png",
    detected: { ...SHEET, measured: { width: 256, height: 256, colorType: "RGBA" } },
  });
  assert.equal(replaced.ok, true);
  if (!replaced.ok) {
    return;
  }
  assert.equal(replaced.meta.id, "hero-walk-cycle.png");
  assert.equal(replaced.meta.description, "Hero walk cycle");
  assert.deepEqual(replaced.meta.tags, ["hero"]);
  assert.equal(replaced.meta.originalFilename, "hero_v2.png");
  assert.equal(replaced.meta.bytes, "new-sheet-bytes".length);
  assert.equal(replaced.meta.measured?.width, 256);
  // The typed grid is kept and re-derived against the new dimensions.
  assert.deepEqual(replaced.meta.grid, { cellWidth: 32, cellHeight: 32 });
  assert.equal(replaced.meta.measured?.grid?.frames, 64);
  // 512-wide sheet had col 15; the 256-wide replacement is 8 columns, so that cell drops.
  assert.deepEqual(replaced.meta.cellGroups, [
    { description: "flower variants", cells: [{ col: 2, row: 0 }, { col: 0, row: 7 }] },
  ]);
  assert.equal(readFileSync(assetFilePath(dir, "hero-walk-cycle.png") as string, "utf8"), "new-sheet-bytes");
});

test("a replacement with a different extension is refused rather than silently renaming", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb"),
    originalFilename: "truck.glb",
    detected: MODEL,
  });
  const wrong = replaceAssetBytes({
    dataDir: dir,
    id: saved.id,
    buffer: Buffer.from("png"),
    originalFilename: "truck.png",
    detected: SHEET,
  });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) {
    assert.match(wrong.reason, /is a \.glb file, and the replacement is \.png/);
  }
  assert.equal(readFileSync(assetFilePath(dir, saved.id) as string, "utf8"), "glb");
});

test("companion files attach, replace by name, and detach", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("gltf"),
    originalFilename: "truck.gltf",
    detected: { ...MODEL, ext: ".gltf", format: "glTF 2.0" },
  });
  const first = attachAssetPart({
    dataDir: dir,
    id: saved.id,
    filename: "Truck Data.bin",
    buffer: Buffer.from("bin-v1"),
  });
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  // The stem is slugged; the extension is left alone because the asset references it.
  assert.deepEqual(first.meta.parts.map((part) => part.filename), ["truck-data.bin"]);

  const again = attachAssetPart({
    dataDir: dir,
    id: saved.id,
    filename: "truck-data.bin",
    buffer: Buffer.from("bin-v2"),
  });
  assert.equal(again.ok, true);
  if (!again.ok) {
    return;
  }
  assert.equal(again.meta.parts.length, 1, "re-attaching the same name replaces it");
  assert.equal(readFileSync(partFilePath(dir, saved.id, "truck-data.bin") as string, "utf8"), "bin-v2");

  const detached = detachAssetPart(dir, saved.id, "truck-data.bin");
  assert.equal(detached.ok, true);
  if (detached.ok) {
    assert.deepEqual(detached.meta.parts, []);
  }
  assert.equal(existsSync(partFilePath(dir, saved.id, "truck-data.bin") as string), false);
  assert.equal(detachAssetPart(dir, saved.id, "truck-data.bin").ok, false);
});

test("a companion file cannot traverse out or shadow the asset itself", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("glb"),
    originalFilename: "truck.glb",
    detected: MODEL,
  });
  assert.equal(partFilePath(dir, saved.id, "../escape.bin"), undefined);
  assert.equal(partFilePath(dir, "../escape.glb", "a.bin"), undefined);
  const shadow = attachAssetPart({
    dataDir: dir,
    id: saved.id,
    filename: saved.id,
    buffer: Buffer.from("x"),
  });
  assert.equal(shadow.ok, false);
  const nameless = attachAssetPart({
    dataDir: dir,
    id: saved.id,
    filename: "...",
    buffer: Buffer.from("x"),
  });
  assert.equal(nameless.ok, false);
});

test("deleting an asset takes its companion files with it", () => {
  const dir = dataDir();
  const saved = saveAsset({
    dataDir: dir,
    buffer: Buffer.from("gltf"),
    originalFilename: "truck.gltf",
    detected: { ...MODEL, ext: ".gltf" },
  });
  attachAssetPart({ dataDir: dir, id: saved.id, filename: "truck.bin", buffer: Buffer.from("bin") });
  const partPath = partFilePath(dir, saved.id, "truck.bin") as string;
  assert.equal(existsSync(partPath), true);
  assert.equal(deleteAsset(dir, saved.id), true);
  assert.equal(existsSync(partPath), false);
  assert.equal(existsSync(assetPartsDir(dir, saved.id) as string), false);
});
