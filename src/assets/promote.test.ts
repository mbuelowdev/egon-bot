import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DetectedAsset } from "./detect.js";
import { promoteAssets } from "./promote.js";
import { attachAssetPart, listAssets, partFilePath, saveAsset, updateAsset } from "./store.js";

const IMAGE: DetectedAsset = {
  kind: "image",
  ext: ".png",
  format: "PNG",
  fileOutput: "PNG image data, 32 x 32",
  mimeType: "image/png",
};

function library(): { dataDir: string; gameRepoDir: string } {
  const root = mkdtempSync(join(tmpdir(), "egon-promote-"));
  const gameRepoDir = join(root, "game");
  mkdirSync(gameRepoDir, { recursive: true });
  return { dataDir: join(root, "data"), gameRepoDir };
}

function describedAsset(dataDir: string, filename: string, description: string, body: string): string {
  const saved = saveAsset({
    dataDir,
    buffer: Buffer.from(body),
    originalFilename: filename,
    detected: IMAGE,
  });
  return (updateAsset(dataDir, saved.id, { description })?.id ?? saved.id);
}

test("promotion copies only declared assets and leaves the library untouched", () => {
  const { dataDir, gameRepoDir } = library();
  const grass = describedAsset(dataDir, "grass.png", "Grass tile", "grass-bytes");
  describedAsset(dataDir, "dirt.png", "Dirt tile", "dirt-bytes");
  const result = promoteAssets({ dataDir, gameRepoDir, ids: [grass] });
  assert.deepEqual(result.copied, ["assets/library/image/grass-tile.png"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.missing, []);
  assert.equal(
    readFileSync(join(gameRepoDir, "assets", "library", "image", "grass-tile.png"), "utf8"),
    "grass-bytes",
  );
  assert.equal(existsSync(join(gameRepoDir, "assets", "library", "image", "dirt-tile.png")), false);
  assert.equal(listAssets(dataDir).length, 2);
});

test("promotion is idempotent across two runs", () => {
  const { dataDir, gameRepoDir } = library();
  const grass = describedAsset(dataDir, "grass.png", "Grass tile", "grass-bytes");
  promoteAssets({ dataDir, gameRepoDir, ids: [grass] });
  const dest = join(gameRepoDir, "assets", "library", "image", "grass-tile.png");
  const firstMtime = statSync(dest).mtimeMs;
  const second = promoteAssets({ dataDir, gameRepoDir, ids: [grass, grass] });
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.skipped, ["assets/library/image/grass-tile.png"]);
  assert.equal(statSync(dest).mtimeMs, firstMtime);
});

test("a repo copy whose contents drifted is replaced", () => {
  const { dataDir, gameRepoDir } = library();
  const grass = describedAsset(dataDir, "grass.png", "Grass tile", "grass-bytes");
  const dest = join(gameRepoDir, "assets", "library", "image", "grass-tile.png");
  mkdirSync(join(gameRepoDir, "assets", "library", "image"), { recursive: true });
  writeFileSync(dest, "someone-hand-edited-this");
  const result = promoteAssets({ dataDir, gameRepoDir, ids: [grass] });
  assert.deepEqual(result.copied, ["assets/library/image/grass-tile.png"]);
  assert.equal(readFileSync(dest, "utf8"), "grass-bytes");
});

test("an id the library does not have is reported, never invented", () => {
  const { dataDir, gameRepoDir } = library();
  const result = promoteAssets({ dataDir, gameRepoDir, ids: ["no-such-asset.png", "../escape.png"] });
  assert.deepEqual(result.missing, ["no-such-asset.png", "../escape.png"]);
  assert.deepEqual(result.copied, []);
  assert.equal(existsSync(join(gameRepoDir, "assets")), false);
});

test("a spec that declares nothing promotes nothing", () => {
  const { dataDir, gameRepoDir } = library();
  describedAsset(dataDir, "grass.png", "Grass tile", "grass-bytes");
  const result = promoteAssets({ dataDir, gameRepoDir, ids: [] });
  assert.deepEqual(result, { copied: [], skipped: [], missing: [] });
  assert.equal(existsSync(join(gameRepoDir, "assets")), false);
});

test("companion files are promoted into the same directory as their asset", () => {
  const { dataDir, gameRepoDir } = library();
  const saved = saveAsset({
    dataDir,
    buffer: Buffer.from("gltf-bytes"),
    originalFilename: "truck.gltf",
    detected: { ...IMAGE, kind: "model", ext: ".gltf", format: "glTF 2.0" },
  });
  const id = updateAsset(dataDir, saved.id, { description: "Garbage truck" })?.id as string;
  attachAssetPart({ dataDir, id, filename: "truck.bin", buffer: Buffer.from("bin-bytes") });
  attachAssetPart({ dataDir, id, filename: "truck_diffuse.png", buffer: Buffer.from("tex-bytes") });

  const result = promoteAssets({ dataDir, gameRepoDir, ids: [id] });
  assert.deepEqual(result.copied, [
    "assets/library/model/garbage-truck.gltf",
    "assets/library/model/truck-diffuse.png",
    "assets/library/model/truck.bin",
  ]);
  assert.deepEqual(result.missing, []);
  // A .gltf references its .bin by relative path, so they must land side by side.
  const dir = join(gameRepoDir, "assets", "library", "model");
  assert.equal(readFileSync(join(dir, "truck.bin"), "utf8"), "bin-bytes");
  assert.equal(readFileSync(join(dir, "truck-diffuse.png"), "utf8"), "tex-bytes");

  const second = promoteAssets({ dataDir, gameRepoDir, ids: [id] });
  assert.deepEqual(second.copied, []);
  assert.equal(second.skipped.length, 3);
});

test("a companion file missing from disk is reported, not silently dropped", () => {
  const { dataDir, gameRepoDir } = library();
  const saved = saveAsset({
    dataDir,
    buffer: Buffer.from("gltf"),
    originalFilename: "truck.gltf",
    detected: { ...IMAGE, kind: "model", ext: ".gltf" },
  });
  const id = updateAsset(dataDir, saved.id, { description: "Garbage truck" })?.id as string;
  attachAssetPart({ dataDir, id, filename: "truck.bin", buffer: Buffer.from("bin") });
  rmSync(partFilePath(dataDir, id, "truck.bin") as string);
  const result = promoteAssets({ dataDir, gameRepoDir, ids: [id] });
  assert.deepEqual(result.copied, ["assets/library/model/garbage-truck.gltf"]);
  assert.deepEqual(result.missing, ["garbage-truck.gltf / truck.bin"]);
});
