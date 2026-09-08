import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { measureAudio, type AudioMeasurement } from "./audio.js";
import { measureGltf, type ModelMeasurement } from "./gltf.js";
import { measureObj } from "./obj.js";
import { assetExtension, classifyUpload, type AssetKind, type UploadVerdict } from "./allowlist.js";

/**
 * `file(1)` identifies the format and, for images, the proportions too. Its
 * human-readable output is not a stable API — the exact strings are pinned in the tests
 * so a `file` upgrade fails loudly rather than silently returning no dimensions — while
 * `--mime-type` is the stable half and is what gates the allowlist.
 */

const run = promisify(execFile);

export type ImageMeasurement = {
  width?: number;
  height?: number;
  colorType?: string;
};

export type GridSpec = { cellWidth: number; cellHeight: number };

export type DerivedGrid = GridSpec & { columns: number; rows: number; frames: number };

export type AssetMeasurement = ImageMeasurement &
  ModelMeasurement &
  AudioMeasurement & { grid?: DerivedGrid };

const FORMAT_LABELS: Record<string, string> = {
  ".png": "PNG",
  ".jpg": "JPEG",
  ".jpeg": "JPEG",
  ".webp": "WebP",
  ".gif": "GIF",
  ".glb": "glTF 2.0 binary",
  ".gltf": "glTF 2.0",
  ".obj": "Wavefront OBJ",
  ".ogg": "Ogg Vorbis",
  ".wav": "WAV",
  ".mp3": "MP3",
  ".ttf": "TrueType",
  ".otf": "OpenType",
  ".woff2": "WOFF2",
};

/** Mime by extension, used only when `file` is unavailable so the portal still works. */
const FALLBACK_MIMES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".glb": "model/gltf-binary",
  ".gltf": "application/json",
  ".obj": "text/plain",
  ".ogg": "audio/ogg",
  ".wav": "audio/x-wav",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
  ".otf": "application/vnd.ms-opentype",
  ".woff2": "font/woff2",
};

const DIMENSION_FIELD_RE = /^(\d+)\s*[x×]\s*(\d+)$/;
const PNG_COLOR_RE = /^\d+-bit(?:\/color)?\s+(.+)$/;

async function fileCommand(args: string[], path: string): Promise<string> {
  try {
    const { stdout } = await run("file", [...args, "--", path], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

export function fileBrief(path: string): Promise<string> {
  return fileCommand(["--brief"], path);
}

export function fileMimeType(path: string): Promise<string> {
  return fileCommand(["--brief", "--mime-type"], path);
}

/**
 * Dimensions out of `file --brief`. Only a field that is *entirely* `W x H` counts —
 * JPEG carries a `density 1x1` field and WebP a `Scaling: [none]x[none]` field, and
 * both would otherwise be read as the image size.
 */
export function parseImageMeasurement(brief: string): ImageMeasurement | undefined {
  const fields = brief.split(",").map((field) => field.trim());
  const index = fields.findIndex((field) => DIMENSION_FIELD_RE.test(field));
  if (index < 0) {
    return undefined;
  }
  const match = DIMENSION_FIELD_RE.exec(fields[index] as string);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  const measurement: ImageMeasurement = { width, height };
  const colorType = parseColorType(fields, index);
  if (colorType !== undefined) {
    measurement.colorType = colorType;
  }
  return measurement;
}

function parseColorType(fields: string[], dimensionIndex: number): string | undefined {
  const components = fields.find((field) => /^components \d+$/.test(field));
  if (components !== undefined) {
    const count = Number(components.slice("components ".length));
    if (count === 1) {
      return "grayscale";
    }
    if (count === 3) {
      return "RGB";
    }
    if (count === 4) {
      return "CMYK";
    }
    return undefined;
  }
  const next = fields[dimensionIndex + 1];
  if (next === undefined) {
    return undefined;
  }
  const png = PNG_COLOR_RE.exec(next);
  return png?.[1];
}

/** Columns, rows, and frame count of a uniform sheet — the numbers `AtlasTexture` wants. */
export function deriveGrid(
  grid: GridSpec | null | undefined,
  image: ImageMeasurement | undefined,
): DerivedGrid | undefined {
  if (!grid || !Number.isInteger(grid.cellWidth) || !Number.isInteger(grid.cellHeight)) {
    return undefined;
  }
  if (grid.cellWidth <= 0 || grid.cellHeight <= 0) {
    return undefined;
  }
  if (image?.width === undefined || image.height === undefined) {
    return undefined;
  }
  const columns = Math.floor(image.width / grid.cellWidth);
  const rows = Math.floor(image.height / grid.cellHeight);
  if (columns < 1 || rows < 1) {
    return undefined;
  }
  return {
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
    columns,
    rows,
    frames: columns * rows,
  };
}

/** Dispatch to the reader for this kind. Never throws: no measurement is a valid answer. */
export function measureBuffer(
  buffer: Buffer,
  kind: AssetKind,
  ext: string,
  brief: string,
): AssetMeasurement | undefined {
  try {
    if (kind === "image") {
      return parseImageMeasurement(brief);
    }
    if (kind === "model") {
      if (ext === ".obj") {
        return measureObj(buffer.toString("utf8"));
      }
      return measureGltf(buffer);
    }
    if (kind === "audio") {
      return measureAudio(buffer, ext);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function formatLabel(ext: string, brief: string): string {
  if (ext === ".ogg" && /opus/i.test(brief)) {
    return "Ogg Opus";
  }
  return FORMAT_LABELS[ext] ?? ext.replace(/^\./, "").toUpperCase();
}

export type DetectedAsset = {
  kind: AssetKind;
  ext: string;
  format: string;
  fileOutput: string;
  mimeType: string;
  measured?: AssetMeasurement;
};

export type DetectionResult = { ok: true; detected: DetectedAsset } | { ok: false; reason: string };

/**
 * Identify a file that is already on disk at `path`. `buffer` is its contents, used by
 * the model and audio readers and for the magic-byte half of the allowlist gate.
 */
export async function detectAsset(options: {
  path: string;
  buffer: Buffer;
  filename: string;
}): Promise<DetectionResult> {
  const ext = assetExtension(options.filename);
  const brief = await fileBrief(options.path);
  const detectedMime = await fileMimeType(options.path);
  const mimeType = detectedMime !== "" ? detectedMime : (FALLBACK_MIMES[ext] ?? "");
  const verdict: UploadVerdict = classifyUpload({
    filename: options.filename,
    head: options.buffer.subarray(0, 64),
    mimeType: detectedMime !== "" ? detectedMime : undefined,
  });
  if (!verdict.ok) {
    return verdict;
  }
  const measured = measureBuffer(options.buffer, verdict.kind, verdict.ext, brief);
  const detected: DetectedAsset = {
    kind: verdict.kind,
    ext: verdict.ext,
    format: formatLabel(verdict.ext, brief),
    fileOutput: brief,
    mimeType,
  };
  if (measured !== undefined) {
    detected.measured = measured;
  }
  return { ok: true, detected };
}
