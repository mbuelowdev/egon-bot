import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedListText,
  assetExtension,
  classifyUpload,
  kindForExtension,
} from "./allowlist.js";

const FBX_HEAD = Buffer.concat([Buffer.from("Kaydara FBX Binary  "), Buffer.alloc(4)]);
const PSD_HEAD = Buffer.concat([Buffer.from("8BPS"), Buffer.alloc(60)]);
const ZIP_HEAD = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("kind and extension come off the filename", () => {
  assert.equal(assetExtension("Garbage Truck.GLB"), ".glb");
  assert.equal(assetExtension("noextension"), "");
  assert.equal(kindForExtension(".png"), "image");
  assert.equal(kindForExtension(".glb"), "model");
  assert.equal(kindForExtension(".ogg"), "audio");
  assert.equal(kindForExtension(".woff2"), "font");
  assert.equal(kindForExtension(".fbx"), undefined);
});

test("every accepted format passes with the mime type file reports", () => {
  const cases: Array<[string, string, string]> = [
    ["sprite.png", "image/png", "image"],
    ["photo.jpeg", "image/jpeg", "image"],
    ["tile.webp", "image/webp", "image"],
    ["anim.gif", "image/gif", "image"],
    ["truck.glb", "model/gltf-binary", "model"],
    ["truck.gltf", "application/json", "model"],
    ["truck.obj", "text/plain", "model"],
    ["hit.ogg", "audio/ogg", "audio"],
    ["hit.wav", "audio/x-wav", "audio"],
    ["song.mp3", "audio/mpeg", "audio"],
    ["ui.ttf", "font/ttf", "font"],
    ["ui.otf", "application/vnd.ms-opentype", "font"],
    ["ui.woff2", "font/woff2", "font"],
  ];
  for (const [filename, mimeType, kind] of cases) {
    const verdict = classifyUpload({ filename, mimeType });
    assert.equal(verdict.ok, true, `${filename} should be accepted`);
    if (verdict.ok) {
      assert.equal(verdict.kind, kind);
    }
  }
});

test("each rejected format says what to do instead", () => {
  const cases: Array<[string, RegExp]> = [
    ["boss.fbx", /FBX2glTF, which is not installed/],
    ["scene.blend", /Blender, which is not installed/],
    ["hud.psd", /Layered source formats are not game assets/],
    ["logo.ai", /Layered source formats are not game assets/],
    ["logo.xcf", /Layered source formats are not game assets/],
    ["hero.aseprite", /Aseprite CLI, which is not installed/],
    ["hero.ase", /Aseprite CLI, which is not installed/],
    ["pack.zip", /Archives are not indexable/],
    ["pack.rar", /Archives are not indexable/],
    ["pack.7z", /Archives are not indexable/],
    ["player.tscn", /belong in the game repo/],
    ["player.gd", /belong in the game repo/],
    ["sprite.png.import", /belong in the game repo/],
  ];
  for (const [filename, reason] of cases) {
    const verdict = classifyUpload({ filename });
    assert.equal(verdict.ok, false, `${filename} should be rejected`);
    if (!verdict.ok) {
      assert.match(verdict.reason, reason);
    }
  }
});

test("an unknown format names itself and the accepted list", () => {
  const verdict = classifyUpload({ filename: "level.tmx", mimeType: "text/xml" });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.match(verdict.reason, /Unsupported format \.tmx/);
    assert.ok(verdict.reason.includes(acceptedListText()));
  }
  const bare = classifyUpload({ filename: "README" });
  assert.equal(bare.ok, false);
  if (!bare.ok) {
    assert.match(bare.reason, /\(no extension\)/);
  }
});

test("renaming a rejected format to a permitted extension does not smuggle it in", () => {
  const fbx = classifyUpload({
    filename: "boss.glb",
    head: FBX_HEAD,
    mimeType: "application/octet-stream",
  });
  assert.equal(fbx.ok, false);
  if (!fbx.ok) {
    assert.match(fbx.reason, /FBX file\. Needs FBX2glTF/);
  }
  const psd = classifyUpload({
    filename: "hud.png",
    head: PSD_HEAD,
    mimeType: "image/vnd.adobe.photoshop",
  });
  assert.equal(psd.ok, false);
  if (!psd.ok) {
    assert.match(psd.reason, /Photoshop file\. Layered source formats/);
  }
  const zip = classifyUpload({ filename: "pack.wav", head: ZIP_HEAD, mimeType: "application/zip" });
  assert.equal(zip.ok, false);
  if (!zip.ok) {
    assert.match(zip.reason, /Zip file\. Archives are not indexable/);
  }
});

test("a mime type that contradicts the extension is refused", () => {
  const verdict = classifyUpload({
    filename: "sprite.png",
    head: PNG_HEAD,
    mimeType: "audio/mpeg",
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.match(verdict.reason, /contents are audio\/mpeg, which is not a valid \.png/);
  }
});

test("no mime type still accepts a permitted extension so the portal works without file(1)", () => {
  const verdict = classifyUpload({ filename: "sprite.png", head: PNG_HEAD });
  assert.equal(verdict.ok, true);
});
