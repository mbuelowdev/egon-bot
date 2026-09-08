import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AssetKind } from "./allowlist.js";
import { assetExtension } from "./allowlist.js";
import { deriveGrid, type AssetMeasurement, type DetectedAsset, type GridSpec } from "./detect.js";

/**
 * The library lives in `$DATA_DIR`, outside the game repo, so unused assets never bloat
 * git and `godot --import` only ever sees what a feature promoted.
 *
 * One sidecar per asset rather than one index file: no write contention between the
 * portal and a concurrent agent run, and deleting the pair is a complete delete.
 */

export const ASSETS_DIR_NAME = "assets";
export const THUMBS_DIR_NAME = ".thumbs";
/** Companion files (a `.gltf`'s `.bin`, an `.obj`'s `.mtl`, extra animation clips). */
export const PARTS_DIR_NAME = ".parts";
export const SIDECAR_SUFFIX = ".json";
/** Where a promoted asset lands in the game repo. Committed with the implementer's work. */
export const PROMOTED_ASSETS_REPO_DIR = "assets/library";

const MAX_ID_STEM = 60;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A file that only makes sense beside the asset it belongs to: the `.bin` and textures a
 * `.gltf` references by relative path, an `.obj`'s `.mtl`, an extra animation clip. It is
 * not an asset of its own — no description, no id, invisible to the manifest — and it is
 * promoted into the same directory as its parent so those relative paths still resolve.
 */
export type AssetPart = {
  filename: string;
  sha256: string;
  bytes: number;
  uploadedAt: string;
};

export type AssetMeta = {
  id: string;
  originalFilename: string;
  sha256: string;
  bytes: number;
  kind: AssetKind;
  format: string;
  fileOutput: string;
  measured?: AssetMeasurement;
  description: string;
  tags: string[];
  grid: GridSpec | null;
  parts: AssetPart[];
  uploadedAt: string;
};

export function assetsDir(dataDir: string): string {
  return join(dataDir, ASSETS_DIR_NAME);
}

export function thumbsDir(dataDir: string): string {
  return join(assetsDir(dataDir), THUMBS_DIR_NAME);
}

export function partsDir(dataDir: string): string {
  return join(assetsDir(dataDir), PARTS_DIR_NAME);
}

/**
 * Ids never contain `/` or `\`, but a hostile one still has to be refused rather than
 * merely slugged away: this is the resolve-then-verify-prefix guard the feature
 * attachment route already uses, applied to every read, write, and delete.
 */
export function isSafeAssetId(id: string): boolean {
  if (id === "" || id.length > 200 || id.includes("/") || id.includes("\\")) {
    return false;
  }
  if (id === "." || id === ".." || id.includes("..")) {
    return false;
  }
  return SAFE_ID_RE.test(id);
}

function inside(dir: string, id: string, suffix = ""): string | undefined {
  if (!isSafeAssetId(id)) {
    return undefined;
  }
  const base = resolve(dir);
  const target = resolve(join(base, `${id}${suffix}`));
  if (!target.startsWith(`${base}/`)) {
    return undefined;
  }
  return target;
}

export function assetFilePath(dataDir: string, id: string): string | undefined {
  return inside(assetsDir(dataDir), id);
}

export function sidecarPath(dataDir: string, id: string): string | undefined {
  return inside(assetsDir(dataDir), id, SIDECAR_SUFFIX);
}

export function thumbFilePath(dataDir: string, id: string): string | undefined {
  return inside(thumbsDir(dataDir), id, ".png");
}

export function assetPartsDir(dataDir: string, id: string): string | undefined {
  return inside(partsDir(dataDir), id);
}

/** Companion filenames are ids in their own right, and get the same traversal guard. */
export function partFilePath(dataDir: string, id: string, filename: string): string | undefined {
  const dir = assetPartsDir(dataDir, id);
  if (dir === undefined || !isSafeAssetId(filename)) {
    return undefined;
  }
  return inside(dir, filename);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function slugifyAssetName(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, MAX_ID_STEM).replace(/-+$/, "");
}

/** `garbage_truck_orange.glb` → `garbage truck orange`, the description's starting point. */
export function descriptionFromFilename(filename: string): string {
  const ext = assetExtension(filename);
  const stem = ext === "" ? filename : filename.slice(0, -ext.length);
  return stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A description is prose ("Orange municipal garbage truck, wheels are separate nodes"),
 * but an id is a filename someone will read in a `res://` path for the rest of the
 * project. Take the opening clause and leave the rest of the sentence out of it.
 */
export function assetNameFromDescription(description: string): string {
  const clause = description.split(/[,.;:\n(\u2014]/)[0] ?? "";
  return slugifyAssetName(clause) || slugifyAssetName(description);
}

/**
 * The stored filename is the asset id, derived from the description at first save and
 * never changed afterwards — a promoted `res://` path must not break when someone edits
 * a description.
 */
export function assetIdFor(options: {
  description: string;
  originalFilename: string;
  ext: string;
  taken: Iterable<string>;
}): string {
  const fromDescription = assetNameFromDescription(options.description);
  const fromFilename = slugifyAssetName(descriptionFromFilename(options.originalFilename));
  const stem = fromDescription !== "" ? fromDescription : fromFilename !== "" ? fromFilename : "asset";
  const used = new Set<string>();
  for (const id of options.taken) {
    used.add(id.toLowerCase());
  }
  let candidate = `${stem}${options.ext}`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-${String(n)}${options.ext}`;
    n += 1;
  }
  return candidate;
}

function parseParts(raw: unknown): AssetPart[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AssetPart[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const part = item as Partial<AssetPart>;
    if (typeof part.filename !== "string" || !isSafeAssetId(part.filename)) {
      continue;
    }
    out.push({
      filename: part.filename,
      sha256: typeof part.sha256 === "string" ? part.sha256 : "",
      bytes: typeof part.bytes === "number" ? part.bytes : 0,
      uploadedAt: typeof part.uploadedAt === "string" ? part.uploadedAt : "",
    });
  }
  return out;
}

function parseMeta(raw: string): AssetMeta | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const meta = parsed as Partial<AssetMeta>;
    if (typeof meta.id !== "string" || !isSafeAssetId(meta.id) || typeof meta.kind !== "string") {
      return undefined;
    }
    return {
      id: meta.id,
      originalFilename: typeof meta.originalFilename === "string" ? meta.originalFilename : meta.id,
      sha256: typeof meta.sha256 === "string" ? meta.sha256 : "",
      bytes: typeof meta.bytes === "number" ? meta.bytes : 0,
      kind: meta.kind as AssetKind,
      format: typeof meta.format === "string" ? meta.format : "",
      fileOutput: typeof meta.fileOutput === "string" ? meta.fileOutput : "",
      ...(meta.measured && typeof meta.measured === "object" ? { measured: meta.measured } : {}),
      description: typeof meta.description === "string" ? meta.description : "",
      tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === "string") : [],
      grid: meta.grid && typeof meta.grid === "object" ? (meta.grid as GridSpec) : null,
      parts: parseParts(meta.parts),
      uploadedAt: typeof meta.uploadedAt === "string" ? meta.uploadedAt : "",
    };
  } catch {
    return undefined;
  }
}

export function readAssetMeta(dataDir: string, id: string): AssetMeta | undefined {
  const path = sidecarPath(dataDir, id);
  if (path === undefined || !existsSync(path)) {
    return undefined;
  }
  try {
    return parseMeta(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function writeAssetMeta(dataDir: string, meta: AssetMeta): void {
  const path = sidecarPath(dataDir, meta.id);
  if (path === undefined) {
    throw new Error(`Refusing to write a sidecar for unsafe asset id: ${meta.id}`);
  }
  mkdirSync(assetsDir(dataDir), { recursive: true });
  writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`);
}

/** Every asset in the library, described or not, sorted by id. Never throws. */
export function listAssets(dataDir: string): AssetMeta[] {
  const dir = assetsDir(dataDir);
  if (!existsSync(dir)) {
    return [];
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: AssetMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(SIDECAR_SUFFIX)) {
      continue;
    }
    const id = name.slice(0, -SIDECAR_SUFFIX.length);
    const meta = readAssetMeta(dataDir, id);
    if (meta !== undefined) {
      out.push(meta);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** An asset without a description is invisible to every agent. */
export function isDescribed(meta: AssetMeta): boolean {
  return meta.description.trim() !== "";
}

export function describedAssets(dataDir: string): AssetMeta[] {
  return listAssets(dataDir).filter(isDescribed);
}

export function findAssetBySha(dataDir: string, sha256: string): AssetMeta | undefined {
  if (sha256 === "") {
    return undefined;
  }
  return listAssets(dataDir).find((meta) => meta.sha256 === sha256);
}

/** Game-repo path this asset gets once a feature promotes it. */
export function promotedAssetPath(meta: Pick<AssetMeta, "id" | "kind">): string {
  return `${PROMOTED_ASSETS_REPO_DIR}/${meta.kind}/${meta.id}`;
}

/** Companions land beside their asset, so a `.gltf`'s relative `.bin` path still resolves. */
export function promotedPartPath(meta: Pick<AssetMeta, "kind">, filename: string): string {
  return `${PROMOTED_ASSETS_REPO_DIR}/${meta.kind}/${filename}`;
}

function withDerivedGrid(measured: AssetMeasurement | undefined, grid: GridSpec | null): AssetMeasurement | undefined {
  const derived = deriveGrid(grid, measured);
  const next: AssetMeasurement = { ...(measured ?? {}) };
  delete next.grid;
  if (derived !== undefined) {
    next.grid = derived;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }
    const clean = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (clean !== "" && !out.includes(clean)) {
      out.push(clean);
    }
  }
  return out.slice(0, 12);
}

export function normalizeGrid(grid: unknown): GridSpec | null {
  if (grid === null || typeof grid !== "object" || Array.isArray(grid)) {
    return null;
  }
  const candidate = grid as { cellWidth?: unknown; cellHeight?: unknown };
  const cellWidth = Number(candidate.cellWidth);
  const cellHeight = Number(candidate.cellHeight);
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
    return null;
  }
  if (cellWidth <= 0 || cellHeight <= 0) {
    return null;
  }
  return { cellWidth, cellHeight };
}

/** Write the bytes and the sidecar. The id is minted here and never changes again. */
export function saveAsset(options: {
  dataDir: string;
  buffer: Buffer;
  originalFilename: string;
  detected: DetectedAsset;
  description?: string;
  tags?: string[];
  grid?: GridSpec | null;
  now?: Date;
}): AssetMeta {
  const description = (options.description ?? "").trim();
  const grid = options.grid ?? null;
  const id = assetIdFor({
    description,
    originalFilename: options.originalFilename,
    ext: options.detected.ext,
    taken: listAssets(options.dataDir).map((meta) => meta.id),
  });
  const path = assetFilePath(options.dataDir, id);
  if (path === undefined) {
    throw new Error(`Refusing to store an unsafe asset id: ${id}`);
  }
  mkdirSync(assetsDir(options.dataDir), { recursive: true });
  writeFileSync(path, options.buffer);
  const measured = withDerivedGrid(options.detected.measured, grid);
  const meta: AssetMeta = {
    id,
    originalFilename: options.originalFilename,
    sha256: sha256Hex(options.buffer),
    bytes: options.buffer.length,
    kind: options.detected.kind,
    format: options.detected.format,
    fileOutput: options.detected.fileOutput,
    ...(measured !== undefined ? { measured } : {}),
    description,
    tags: normalizeTags(options.tags),
    grid,
    parts: [],
    uploadedAt: (options.now ?? new Date()).toISOString(),
  };
  writeAssetMeta(options.dataDir, meta);
  return meta;
}

function renameAsset(dataDir: string, from: string, to: string): void {
  const oldPath = assetFilePath(dataDir, from);
  const newPath = assetFilePath(dataDir, to);
  const oldSidecar = sidecarPath(dataDir, from);
  const oldThumb = thumbFilePath(dataDir, from);
  const newThumb = thumbFilePath(dataDir, to);
  const oldParts = assetPartsDir(dataDir, from);
  const newParts = assetPartsDir(dataDir, to);
  if (oldPath === undefined || newPath === undefined || oldSidecar === undefined) {
    throw new Error(`Refusing to rename between unsafe asset ids: ${from} -> ${to}`);
  }
  renameSync(oldPath, newPath);
  rmSync(oldSidecar, { force: true });
  if (oldThumb !== undefined && newThumb !== undefined && existsSync(oldThumb)) {
    renameSync(oldThumb, newThumb);
  }
  if (oldParts !== undefined && newParts !== undefined && existsSync(oldParts)) {
    renameSync(oldParts, newParts);
  }
}

/**
 * The id is derived from the description at first save — that is what turns a cryptic
 * `a3f9c2d1.glb` into `garbage-truck-orange.glb`. After that it is frozen: editing a
 * description never renames the file, because a promoted `res://` path must not break.
 * The one rename can never break one either, since an undescribed asset is invisible to
 * every agent and so was never in a manifest, a spec, or a promotion.
 */
export function updateAsset(
  dataDir: string,
  id: string,
  patch: { description?: string; tags?: string[]; grid?: GridSpec | null },
): AssetMeta | undefined {
  const meta = readAssetMeta(dataDir, id);
  if (meta === undefined) {
    return undefined;
  }
  const description = patch.description === undefined ? meta.description : patch.description.trim();
  const grid = patch.grid === undefined ? meta.grid : patch.grid;
  const measured = withDerivedGrid(meta.measured, grid);
  const next: AssetMeta = {
    ...meta,
    description,
    tags: patch.tags === undefined ? meta.tags : normalizeTags(patch.tags),
    grid,
  };
  if (measured === undefined) {
    delete next.measured;
  } else {
    next.measured = measured;
  }
  if (!isDescribed(meta) && description !== "") {
    const ext = assetExtension(meta.id);
    const minted = assetIdFor({
      description,
      originalFilename: meta.originalFilename,
      ext,
      taken: listAssets(dataDir)
        .map((other) => other.id)
        .filter((other) => other !== meta.id),
    });
    if (minted !== meta.id) {
      renameAsset(dataDir, meta.id, minted);
      next.id = minted;
    }
  }
  writeAssetMeta(dataDir, next);
  return next;
}

/** Asset, sidecar, and thumbnail. Does not touch a copy already promoted into the game repo. */
export function deleteAsset(dataDir: string, id: string): boolean {
  const path = assetFilePath(dataDir, id);
  const sidecar = sidecarPath(dataDir, id);
  const thumb = thumbFilePath(dataDir, id);
  const parts = assetPartsDir(dataDir, id);
  if (path === undefined || sidecar === undefined || thumb === undefined || parts === undefined) {
    return false;
  }
  if (!existsSync(sidecar) && !existsSync(path)) {
    return false;
  }
  rmSync(path, { force: true });
  rmSync(sidecar, { force: true });
  rmSync(thumb, { force: true });
  rmSync(parts, { recursive: true, force: true });
  return true;
}

export type AssetWriteResult = { ok: true; meta: AssetMeta } | { ok: false; reason: string };

/**
 * Rename the stored file. The id is normally frozen after first save, because promotion
 * writes it into the game repo as `assets/library/{kind}/{id}` and specs name it — this
 * is the one deliberate exception, and it is a human's call, not something a description
 * edit does behind their back.
 *
 * It is recoverable rather than catastrophic: a merged feature's copy is committed in the
 * game repo and keeps working at the old path, and a spec that named the old id and has
 * not been implemented yet fails the gate loudly instead of shipping a broken `res://`.
 */
export function renameAssetId(dataDir: string, id: string, stem: string): AssetWriteResult {
  const meta = readAssetMeta(dataDir, id);
  if (meta === undefined) {
    return { ok: false, reason: "That asset is not in the library." };
  }
  const slug = slugifyAssetName(stem);
  if (slug === "") {
    return { ok: false, reason: "A filename needs at least one letter or digit." };
  }
  const next = `${slug}${assetExtension(meta.id)}`;
  if (next === meta.id) {
    return { ok: true, meta };
  }
  const taken = listAssets(dataDir).some((other) => other.id.toLowerCase() === next.toLowerCase());
  if (taken) {
    return { ok: false, reason: `\`${next}\` is already in the library. Pick another name.` };
  }
  renameAsset(dataDir, meta.id, next);
  const renamed: AssetMeta = { ...meta, id: next };
  writeAssetMeta(dataDir, renamed);
  return { ok: true, meta: renamed };
}

/**
 * Swap the bytes behind an existing asset, keeping its id and everything a human typed.
 * The extension has to match: the id is a path other things already point at, and its
 * extension is a claim about the format that the new bytes have to keep true.
 */
export function replaceAssetBytes(options: {
  dataDir: string;
  id: string;
  buffer: Buffer;
  originalFilename: string;
  detected: DetectedAsset;
  now?: Date;
}): AssetWriteResult {
  const meta = readAssetMeta(options.dataDir, options.id);
  if (meta === undefined) {
    return { ok: false, reason: "That asset is not in the library." };
  }
  const current = assetExtension(meta.id);
  if (options.detected.ext !== current) {
    return {
      ok: false,
      reason: `\`${meta.id}\` is a ${current} file, and the replacement is ${options.detected.ext}. Upload it as a new asset, or rename this one first.`,
    };
  }
  const path = assetFilePath(options.dataDir, meta.id);
  if (path === undefined) {
    return { ok: false, reason: "That asset id is not one this library can write." };
  }
  writeFileSync(path, options.buffer);
  const measured = withDerivedGrid(options.detected.measured, meta.grid);
  const next: AssetMeta = {
    ...meta,
    originalFilename: options.originalFilename,
    sha256: sha256Hex(options.buffer),
    bytes: options.buffer.length,
    format: options.detected.format,
    fileOutput: options.detected.fileOutput,
    uploadedAt: (options.now ?? new Date()).toISOString(),
  };
  if (measured === undefined) {
    delete next.measured;
  } else {
    next.measured = measured;
  }
  writeAssetMeta(options.dataDir, next);
  return { ok: true, meta: next };
}

/** A companion filename keeps its own extension, so only the stem is slugged. */
export function safePartName(filename: string): string {
  const ext = assetExtension(filename);
  const stem = ext === "" ? filename : filename.slice(0, -ext.length);
  const slug = slugifyAssetName(stem);
  return slug === "" ? "" : `${slug}${ext}`;
}

/**
 * Attach a companion file. Re-attaching the same name replaces it, which is what someone
 * re-exporting a `.bin` beside its `.gltf` means to do.
 */
export function attachAssetPart(options: {
  dataDir: string;
  id: string;
  filename: string;
  buffer: Buffer;
  now?: Date;
}): AssetWriteResult {
  const meta = readAssetMeta(options.dataDir, options.id);
  if (meta === undefined) {
    return { ok: false, reason: "That asset is not in the library." };
  }
  const filename = safePartName(options.filename);
  if (filename === "") {
    return { ok: false, reason: "That file needs a name with at least one letter or digit." };
  }
  if (filename === meta.id) {
    return { ok: false, reason: "A companion file cannot have the same name as the asset itself." };
  }
  const dir = assetPartsDir(options.dataDir, meta.id);
  const path = partFilePath(options.dataDir, meta.id, filename);
  if (dir === undefined || path === undefined) {
    return { ok: false, reason: "That filename is not one this library can write." };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, options.buffer);
  const part: AssetPart = {
    filename,
    sha256: sha256Hex(options.buffer),
    bytes: options.buffer.length,
    uploadedAt: (options.now ?? new Date()).toISOString(),
  };
  const parts = meta.parts.filter((existing) => existing.filename !== filename);
  parts.push(part);
  parts.sort((a, b) => a.filename.localeCompare(b.filename));
  const next: AssetMeta = { ...meta, parts };
  writeAssetMeta(options.dataDir, next);
  return { ok: true, meta: next };
}

export function detachAssetPart(dataDir: string, id: string, filename: string): AssetWriteResult {
  const meta = readAssetMeta(dataDir, id);
  if (meta === undefined) {
    return { ok: false, reason: "That asset is not in the library." };
  }
  const path = partFilePath(dataDir, id, filename);
  if (path === undefined) {
    return { ok: false, reason: "That filename is not one this library can write." };
  }
  if (!meta.parts.some((part) => part.filename === filename)) {
    return { ok: false, reason: "That file is not attached to this asset." };
  }
  rmSync(path, { force: true });
  const next: AssetMeta = { ...meta, parts: meta.parts.filter((part) => part.filename !== filename) };
  writeAssetMeta(dataDir, next);
  return { ok: true, meta: next };
}

export function saveThumbnail(dataDir: string, id: string, buffer: Buffer): boolean {
  const path = thumbFilePath(dataDir, id);
  if (path === undefined) {
    return false;
  }
  mkdirSync(thumbsDir(dataDir), { recursive: true });
  writeFileSync(path, buffer);
  return true;
}
