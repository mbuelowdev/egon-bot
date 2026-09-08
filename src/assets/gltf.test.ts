import assert from "node:assert/strict";
import { test } from "node:test";
import { measureGltf, readGlbJson } from "./gltf.js";
import { measureObj } from "./obj.js";

const TRUCK = {
  asset: { version: "2.0" },
  accessors: [
    { count: 620, type: "VEC3", min: [-1.05, 0, -2.7], max: [1.05, 1.9, 2.7] },
    { count: 3720 },
    { count: 40, type: "VEC3", min: [-0.4, 0, -0.4], max: [0.4, 0.4, 0.4] },
    { count: 96 },
  ],
  meshes: [
    { name: "Body", primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] },
    { name: "Wheel", primitives: [{ attributes: { POSITION: 2 }, indices: 3 }] },
  ],
  nodes: [{ name: "Truck" }, { name: "WheelFL" }],
  materials: [{ name: "Paint_Orange" }],
  animations: [{ name: "wheels_spin" }],
};

/** A GLB container around `json`: 12-byte header, then chunk 0 is the document. */
function makeGlb(json: unknown, options: { truncate?: boolean } = {}): Buffer {
  let body = Buffer.from(JSON.stringify(json), "utf8");
  while (body.length % 4 !== 0) {
    body = Buffer.concat([body, Buffer.from(" ")]);
  }
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + body.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(body.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  const glb = Buffer.concat([header, chunk, body]);
  return options.truncate ? glb.subarray(0, glb.length - 40) : glb;
}

test("a GLB and the equivalent .gltf yield the same measurements", () => {
  const fromGlb = measureGltf(makeGlb(TRUCK));
  const fromGltf = measureGltf(Buffer.from(JSON.stringify(TRUCK), "utf8"));
  assert.deepEqual(fromGlb, fromGltf);
  assert.deepEqual(fromGlb?.bboxMeters, [2.1, 1.9, 5.4]);
  assert.equal(fromGlb?.triangles, 1272);
  assert.equal(fromGlb?.meshes, 2);
  assert.deepEqual(fromGlb?.materials, ["Paint_Orange"]);
  assert.deepEqual(fromGlb?.animations, ["wheels_spin"]);
  assert.deepEqual(fromGlb?.nodes, ["Truck", "WheelFL"]);
});

test("a model whose POSITION accessor lacks min/max records no bbox but still measures", () => {
  const measured = measureGltf(
    Buffer.from(
      JSON.stringify({
        accessors: [{ count: 300 }, { count: 900 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      }),
      "utf8",
    ),
  );
  assert.equal(measured?.bboxMeters, undefined);
  assert.equal(measured?.triangles, 300);
  assert.equal(measured?.meshes, 1);
});

test("a truncated or corrupt GLB measures nothing instead of throwing", () => {
  assert.equal(measureGltf(makeGlb(TRUCK, { truncate: true })), undefined);
  assert.equal(measureGltf(Buffer.from("not a model at all")), undefined);
  assert.equal(measureGltf(Buffer.alloc(0)), undefined);
  assert.equal(readGlbJson(Buffer.from("glTF")), undefined);
});

test("non-triangle primitives are not counted as triangles", () => {
  const measured = measureGltf(
    Buffer.from(
      JSON.stringify({
        accessors: [{ count: 60, min: [0, 0, 0], max: [1, 1, 1] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
      }),
      "utf8",
    ),
  );
  assert.equal(measured?.triangles, undefined);
  assert.deepEqual(measured?.bboxMeters, [1, 1, 1]);
});

test("OBJ measures a bbox, a fanned face count, and usemtl names", () => {
  const measured = measureObj(
    [
      "# a crate",
      "o Crate",
      "usemtl Wood",
      "v 0 0 0",
      "v 2 0 0",
      "v 2 3 0",
      "v 0 3 0",
      "v 0 0 1.5",
      "f 1 2 3",
      "f 1/1/1 2/2/2 3/3/3 4/4/4",
      "usemtl Wood",
    ].join("\n"),
  );
  assert.deepEqual(measured?.bboxMeters, [2, 3, 1.5]);
  assert.equal(measured?.triangles, 3);
  assert.equal(measured?.meshes, 1);
  assert.deepEqual(measured?.materials, ["Wood"]);
});

test("an OBJ with no vertices measures nothing", () => {
  assert.equal(measureObj("# nothing here\n"), undefined);
});
