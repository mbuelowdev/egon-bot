import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { deriveGrid, detectAsset, formatLabel, parseImageMeasurement } from "./detect.js";

/**
 * `file`'s human-readable output is not a stable API, so the exact strings are pinned
 * here: a `file` upgrade that reshapes them fails loudly instead of silently returning
 * no dimensions for every image in the library.
 */
const FILE_5_47 = {
  png: "PNG image data, 32 x 32, 8-bit/color RGBA, non-interlaced",
  pngIndexed: "PNG image data, 64 x 48, 1-bit colormap, non-interlaced",
  jpeg:
    "JPEG image data, JFIF standard 1.01, aspect ratio, density 1x1, segment length 16, baseline, precision 8, 640x480, components 3",
  gif: "GIF image data, version 89a, 32 x 32",
  webp:
    "RIFF (little-endian) data, Web/P image, VP8 encoding, 512x256, Scaling: [none]x[none], YUV color, decoders should clamp",
  glb: "glTF binary model, version 2, length 80 bytes",
  wav: "RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, stereo 44100 Hz",
};

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A real, decodable PNG so the live `file` test measures something `file` actually parsed. */
function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type: RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) {
    raw.writeUInt8(0, row * (1 + width * 4)); // filter: none
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("file output parses to the right dimensions for every accepted image format", () => {
  assert.deepEqual(parseImageMeasurement(FILE_5_47.png), {
    width: 32,
    height: 32,
    colorType: "RGBA",
  });
  assert.deepEqual(parseImageMeasurement(FILE_5_47.pngIndexed), {
    width: 64,
    height: 48,
    colorType: "colormap",
  });
  assert.deepEqual(parseImageMeasurement(FILE_5_47.gif), { width: 32, height: 32 });
  assert.deepEqual(parseImageMeasurement(FILE_5_47.webp), { width: 512, height: 256 });
});

test("a JPEG's density field is not mistaken for its dimensions", () => {
  assert.deepEqual(parseImageMeasurement(FILE_5_47.jpeg), {
    width: 640,
    height: 480,
    colorType: "RGB",
  });
});

test("a file string with no dimensions measures nothing rather than guessing", () => {
  assert.equal(parseImageMeasurement(FILE_5_47.glb), undefined);
  assert.equal(parseImageMeasurement(FILE_5_47.wav), undefined);
  assert.equal(parseImageMeasurement("data"), undefined);
});

test("format labels name the format a human recognises", () => {
  assert.equal(formatLabel(".glb", FILE_5_47.glb), "glTF 2.0 binary");
  assert.equal(formatLabel(".png", FILE_5_47.png), "PNG");
  assert.equal(formatLabel(".ogg", "Ogg data, Opus audio,"), "Ogg Opus");
  assert.equal(formatLabel(".ogg", "Ogg data, Vorbis audio, stereo, 44100 Hz"), "Ogg Vorbis");
});

test("a 32 x 32 grid on a 512 x 256 sheet is 16 x 8 = 128 frames", () => {
  assert.deepEqual(deriveGrid({ cellWidth: 32, cellHeight: 32 }, { width: 512, height: 256 }), {
    cellWidth: 32,
    cellHeight: 32,
    columns: 16,
    rows: 8,
    frames: 128,
  });
});

test("a grid without a cell size or without image dimensions derives nothing", () => {
  assert.equal(deriveGrid(null, { width: 512, height: 256 }), undefined);
  assert.equal(deriveGrid({ cellWidth: 0, cellHeight: 32 }, { width: 512, height: 256 }), undefined);
  assert.equal(deriveGrid({ cellWidth: 32, cellHeight: 32 }, undefined), undefined);
  assert.equal(deriveGrid({ cellWidth: 900, cellHeight: 32 }, { width: 512, height: 256 }), undefined);
});

test("detectAsset runs file(1) and measures a real PNG end to end", async () => {
  try {
    execFileSync("file", ["--version"], { stdio: "ignore" });
  } catch {
    return; // file(1) is in the image; a dev box without it should not fail the suite.
  }
  const dir = mkdtempSync(join(tmpdir(), "egon-detect-"));
  const path = join(dir, "upload.bin");
  const buffer = makePng(48, 24);
  writeFileSync(path, buffer);
  const result = await detectAsset({ path, buffer, filename: "grass_plain.png" });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.detected.kind, "image");
  assert.equal(result.detected.mimeType, "image/png");
  assert.equal(result.detected.format, "PNG");
  assert.equal(result.detected.measured?.width, 48);
  assert.equal(result.detected.measured?.height, 24);
  assert.match(result.detected.fileOutput, /^PNG image data, 48 x 24,/);
});

test("detectAsset refuses a rejected format on its contents", async () => {
  try {
    execFileSync("file", ["--version"], { stdio: "ignore" });
  } catch {
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "egon-detect-reject-"));
  const path = join(dir, "upload.bin");
  const buffer = Buffer.concat([Buffer.from("Kaydara FBX Binary  "), Buffer.alloc(32)]);
  writeFileSync(path, buffer);
  const result = await detectAsset({ path, buffer, filename: "boss.glb" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /FBX/);
  }
});
