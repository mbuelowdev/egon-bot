import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mimeFor } from "../godot/headers.js";
import { assetExtension } from "./allowlist.js";
import { detectAsset } from "./detect.js";
import { refreshAssetManifest } from "./manifest.js";
import { assetPortalPage, portalAsset } from "./portalPage.js";
import {
  assetFilePath,
  attachAssetPart,
  deleteAsset,
  detachAssetPart,
  findAssetBySha,
  isSafeAssetId,
  listAssets,
  normalizeGrid,
  partFilePath,
  renameAssetId,
  replaceAssetBytes,
  saveAsset,
  saveThumbnail,
  sha256Hex,
  slugifyAssetName,
  thumbFilePath,
  updateAsset,
  type AssetMeta,
  type AssetWriteResult,
} from "./store.js";

/**
 * The six portal routes. Writes are gated by the same `ente123` the catalog's delete
 * already uses — no new secret and no new env var, because the portal is for a handful of
 * friends, not the public. Every id goes through the same resolve-then-verify-prefix
 * guard as the feature-attachment route.
 */

/** A drop of forty sprites is normal; a 200 MB video is not. */
export const MAX_UPLOAD_BYTES = 96 * 1024 * 1024;

export type AssetRouteDeps = {
  dataDir: string;
  passwordOk: (password: string) => boolean;
  parseJsonPassword: (raw: Buffer) => string | undefined;
};

type MultipartField = { name: string; filename?: string; data: Buffer };

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > limit) {
      return undefined;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function multipartBoundary(contentType: string | undefined): string | undefined {
  if (contentType === undefined || !contentType.toLowerCase().includes("multipart/form-data")) {
    return undefined;
  }
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2])?.trim();
  return boundary === undefined || boundary === "" ? undefined : boundary;
}

/**
 * Enough of RFC 7578 to carry one file plus a few text fields. Parts are split on the
 * boundary as bytes, never as a string, so binary payloads survive intact.
 */
export function parseMultipart(body: Buffer, boundary: string): MultipartField[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: MultipartField[] = [];
  let index = body.indexOf(delimiter);
  while (index >= 0) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") {
      break;
    }
    const next = body.indexOf(delimiter, start);
    const end = next < 0 ? body.length : next;
    const part = body.subarray(start, end);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd >= 0) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const disposition = /content-disposition:[^\n]*/i.exec(headers)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
      if (name !== undefined) {
        let data = part.subarray(headerEnd + 4);
        if (data.subarray(-2).toString("latin1") === "\r\n") {
          data = data.subarray(0, -2);
        }
        fields.push({ name, data, ...(filename !== undefined ? { filename } : {}) });
      }
    }
    if (next < 0) {
      break;
    }
    index = next;
  }
  return fields;
}

function textField(fields: MultipartField[], name: string): string | undefined {
  const field = fields.find((item) => item.name === name && item.filename === undefined);
  return field === undefined ? undefined : field.data.toString("utf8");
}

function fileField(fields: MultipartField[], name: string): MultipartField | undefined {
  return fields.find((item) => item.name === name && item.filename !== undefined);
}

function parseJsonField(raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function sendAssetFile(res: ServerResponse, filePath: string | undefined): void {
  if (filePath === undefined) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mimeFor(filePath), "Cache-Control": "no-store" });
  createReadStream(filePath).pipe(res);
}

function assetResponse(meta: AssetMeta, duplicate = false): { asset: ReturnType<typeof portalAsset>; duplicate: boolean } {
  return { asset: portalAsset(meta), duplicate };
}

/**
 * Handle a `/assets…` request. Returns false when the path is not ours so the catalog
 * server can carry on to its own routes.
 */
export async function handleAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  deps: AssetRouteDeps,
): Promise<boolean> {
  if (urlPath !== "/assets" && !urlPath.startsWith("/assets/")) {
    return false;
  }
  // Ids never contain a separator, so a decoded path that walks up is hostile, not a typo.
  if (urlPath.includes("\\") || urlPath.split("/").includes("..")) {
    sendText(res, 403, "Forbidden");
    return true;
  }

  if (req.method === "GET" && (urlPath === "/assets" || urlPath === "/assets/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(assetPortalPage(listAssets(deps.dataDir)));
    return true;
  }

  const partMatch = /^\/assets\/part\/([^/]+)\/([^/]+)$/.exec(urlPath);
  if (req.method === "GET" && partMatch?.[1] && partMatch[2]) {
    sendAssetFile(res, partFilePath(deps.dataDir, partMatch[1], partMatch[2]));
    return true;
  }

  const fileMatch = /^\/assets\/(file|thumb)\/(.+)$/.exec(urlPath);
  if (req.method === "GET" && fileMatch?.[1] && fileMatch[2]) {
    const id = fileMatch[2];
    if (!isSafeAssetId(id)) {
      sendText(res, 403, "Forbidden");
      return true;
    }
    sendAssetFile(
      res,
      fileMatch[1] === "thumb" ? thumbFilePath(deps.dataDir, id) : assetFilePath(deps.dataDir, id),
    );
    return true;
  }

  if (req.method === "POST" && (urlPath === "/assets" || urlPath === "/assets/")) {
    await handleUpload(req, res, deps);
    return true;
  }

  const deleteMatch = /^\/assets\/([^/]+)\/delete\/?$/.exec(urlPath);
  if (req.method === "POST" && deleteMatch?.[1]) {
    if ((await readJsonPassword(req, res, deps)) === undefined) {
      return true;
    }
    const id = deleteMatch[1];
    if (!isSafeAssetId(id)) {
      sendText(res, 403, "Forbidden");
      return true;
    }
    if (!deleteAsset(deps.dataDir, id)) {
      sendText(res, 404, "Not found");
      return true;
    }
    refreshAssetManifest(deps.dataDir);
    sendText(res, 204, "");
    return true;
  }

  const replaceMatch = /^\/assets\/([^/]+)\/replace\/?$/.exec(urlPath);
  if (req.method === "POST" && replaceMatch?.[1]) {
    await handleReplace(req, res, replaceMatch[1], deps);
    return true;
  }

  const detachMatch = /^\/assets\/([^/]+)\/attach\/([^/]+)\/delete\/?$/.exec(urlPath);
  if (req.method === "POST" && detachMatch?.[1] && detachMatch[2]) {
    const password = await readJsonPassword(req, res, deps);
    if (password === undefined) {
      return true;
    }
    sendWrite(res, detachAssetPart(deps.dataDir, detachMatch[1], detachMatch[2]), deps);
    return true;
  }

  const attachMatch = /^\/assets\/([^/]+)\/attach\/?$/.exec(urlPath);
  if (req.method === "POST" && attachMatch?.[1]) {
    await handleAttach(req, res, attachMatch[1], deps);
    return true;
  }

  const saveMatch = /^\/assets\/([^/]+)\/?$/.exec(urlPath);
  if (req.method === "POST" && saveMatch?.[1]) {
    await handleSave(req, res, saveMatch[1], deps);
    return true;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return true;
  }
  sendText(res, 404, "Not found");
  return true;
}

/** `file(1)` identifies a path, so the bytes need a scratch file before detection. */
async function detectUpload(
  buffer: Buffer,
  filename: string,
): Promise<Awaited<ReturnType<typeof detectAsset>>> {
  const scratch = mkdtempSync(join(tmpdir(), "egon-asset-"));
  try {
    const probe = join(scratch, "upload.bin");
    writeFileSync(probe, buffer);
    return await detectAsset({ path: probe, buffer, filename });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Shared by the JSON-bodied write routes: delete and detach. */
async function readJsonPassword(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AssetRouteDeps,
): Promise<string | undefined> {
  const raw = await readBody(req, 64 * 1024);
  if (raw === undefined) {
    sendText(res, 413, "Body too large");
    return undefined;
  }
  const password = deps.parseJsonPassword(raw);
  if (password === undefined || !deps.passwordOk(password)) {
    sendText(res, 403, "Wrong password");
    return undefined;
  }
  return password;
}

/** A store write that can fail with a reason a human can act on. */
function sendWrite(res: ServerResponse, result: AssetWriteResult, deps: AssetRouteDeps): void {
  if (!result.ok) {
    sendText(res, 409, result.reason);
    return;
  }
  refreshAssetManifest(deps.dataDir);
  sendJson(res, 200, assetResponse(result.meta));
}

async function readMultipart(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AssetRouteDeps,
): Promise<MultipartField[] | undefined> {
  const boundary = multipartBoundary(req.headers["content-type"]);
  if (boundary === undefined) {
    sendText(res, 400, "Expected multipart/form-data");
    return undefined;
  }
  const raw = await readBody(req, MAX_UPLOAD_BYTES);
  if (raw === undefined) {
    sendText(res, 413, "File is too large for the library");
    return undefined;
  }
  const fields = parseMultipart(raw, boundary);
  const password = textField(fields, "password");
  if (password === undefined || !deps.passwordOk(password)) {
    sendText(res, 403, "Wrong password");
    return undefined;
  }
  return fields;
}

async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AssetRouteDeps,
): Promise<void> {
  const fields = await readMultipart(req, res, deps);
  if (fields === undefined) {
    return;
  }
  const file = fileField(fields, "file");
  if (file === undefined || file.filename === undefined || file.filename === "") {
    sendText(res, 400, "No file in the upload");
    return;
  }
  if (file.data.length === 0) {
    sendText(res, 400, "That file is empty");
    return;
  }
  // Re-uploading identical bytes under a different name resolves to the existing asset.
  const existing = findAssetBySha(deps.dataDir, sha256Hex(file.data));
  if (existing !== undefined) {
    sendJson(res, 200, assetResponse(existing, true));
    return;
  }
  const detection = await detectUpload(file.data, file.filename);
  if (!detection.ok) {
    sendText(res, 415, detection.reason);
    return;
  }
  const meta = saveAsset({
    dataDir: deps.dataDir,
    buffer: file.data,
    originalFilename: file.filename,
    detected: detection.detected,
    description: textField(fields, "description") ?? "",
    tags: [],
    grid: null,
  });
  refreshAssetManifest(deps.dataDir);
  sendJson(res, 201, assetResponse(meta));
}

async function handleSave(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  deps: AssetRouteDeps,
): Promise<void> {
  if (!isSafeAssetId(id)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const fields = await readMultipart(req, res, deps);
  if (fields === undefined) {
    return;
  }
  const description = textField(fields, "description");
  const tagsRaw = parseJsonField(textField(fields, "tags"));
  const updated = updateAsset(deps.dataDir, id, {
    ...(description !== undefined ? { description } : {}),
    ...(Array.isArray(tagsRaw)
      ? { tags: tagsRaw.filter((tag): tag is string => typeof tag === "string") }
      : {}),
    grid: normalizeGrid(parseJsonField(textField(fields, "grid"))),
  });
  if (updated === undefined) {
    sendText(res, 404, "Not found");
    return;
  }
  // The portal always posts the filename box. That is a rename only when the human
  // actually changed it — otherwise first-save still mints the id from the description,
  // which is how `a3f9c2d1.glb` becomes `garbage-truck-orange.glb`.
  let meta = updated;
  const stem = textField(fields, "filename");
  if (stem !== undefined && stem.trim() !== "") {
    const requested = `${slugifyAssetName(stem)}${assetExtension(id)}`;
    if (requested !== id) {
      const renamed = renameAssetId(deps.dataDir, meta.id, stem);
      if (!renamed.ok) {
        refreshAssetManifest(deps.dataDir);
        sendText(res, 409, renamed.reason);
        return;
      }
      meta = renamed.meta;
    }
  }
  const thumb = fileField(fields, "thumb");
  if (thumb !== undefined && thumb.data.length > 0) {
    saveThumbnail(deps.dataDir, meta.id, thumb.data);
  }
  refreshAssetManifest(deps.dataDir);
  sendJson(res, 200, assetResponse(meta));
}

/**
 * Swap the bytes behind an existing asset. The description, tags, grid, and id all stay:
 * this is "here is a better export of the same thing", not a new asset.
 */
async function handleReplace(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  deps: AssetRouteDeps,
): Promise<void> {
  if (!isSafeAssetId(id)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const fields = await readMultipart(req, res, deps);
  if (fields === undefined) {
    return;
  }
  const file = fileField(fields, "file");
  if (file === undefined || file.filename === undefined || file.filename === "" || file.data.length === 0) {
    sendText(res, 400, "No file in the upload");
    return;
  }
  const detection = await detectUpload(file.data, file.filename);
  if (!detection.ok) {
    sendText(res, 415, detection.reason);
    return;
  }
  sendWrite(
    res,
    replaceAssetBytes({
      dataDir: deps.dataDir,
      id,
      buffer: file.data,
      originalFilename: file.filename,
      detected: detection.detected,
    }),
    deps,
  );
}

/**
 * Attach a companion file. It is deliberately not put through the asset allowlist: a
 * `.gltf`'s `.bin`, an `.obj`'s `.mtl`, and a `.tres` animation are all things a real
 * asset needs beside it and none of them are assets in their own right. It never enters
 * the manifest and no spec can name it, so it cannot become game content on its own.
 */
async function handleAttach(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  deps: AssetRouteDeps,
): Promise<void> {
  if (!isSafeAssetId(id)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const fields = await readMultipart(req, res, deps);
  if (fields === undefined) {
    return;
  }
  const file = fileField(fields, "file");
  if (file === undefined || file.filename === undefined || file.filename === "" || file.data.length === 0) {
    sendText(res, 400, "No file in the upload");
    return;
  }
  sendWrite(
    res,
    attachAssetPart({
      dataDir: deps.dataDir,
      id,
      filename: file.filename,
      buffer: file.data,
    }),
    deps,
  );
}
