import type { ModelMeasurement } from "./gltf.js";

/**
 * Wavefront OBJ is text: the bounding box is min/max over `v` lines, the triangle count
 * comes from fanning each `f` polygon, and material names come from `usemtl`. No
 * companion `.mtl` is read — it is not guaranteed to have been uploaded.
 */

const VERTEX_RE = /^v\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/;
const FACE_RE = /^f\s+(.+)$/;
const USEMTL_RE = /^usemtl\s+(\S.*?)\s*$/;
const OBJECT_RE = /^o\s+\S/;

export function measureObj(text: string): ModelMeasurement | undefined {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  let triangles = 0;
  let objects = 0;
  const materials: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const vertex = VERTEX_RE.exec(line);
    if (vertex) {
      const coords = [Number(vertex[1]), Number(vertex[2]), Number(vertex[3])];
      if (coords.every((n) => Number.isFinite(n))) {
        for (let i = 0; i < 3; i += 1) {
          min[i] = Math.min(min[i] as number, coords[i] as number);
          max[i] = Math.max(max[i] as number, coords[i] as number);
        }
        vertices += 1;
      }
      continue;
    }
    const face = FACE_RE.exec(line);
    if (face?.[1] !== undefined) {
      const corners = face[1].trim().split(/\s+/).length;
      if (corners >= 3) {
        triangles += corners - 2;
      }
      continue;
    }
    const material = USEMTL_RE.exec(line);
    if (material?.[1] !== undefined && !materials.includes(material[1])) {
      materials.push(material[1]);
      continue;
    }
    if (OBJECT_RE.test(line)) {
      objects += 1;
    }
  }
  const measurement: ModelMeasurement = {};
  if (vertices > 0) {
    measurement.bboxMeters = [
      Math.round(((max[0] as number) - (min[0] as number)) * 1000) / 1000,
      Math.round(((max[1] as number) - (min[1] as number)) * 1000) / 1000,
      Math.round(((max[2] as number) - (min[2] as number)) * 1000) / 1000,
    ];
  }
  if (triangles > 0) {
    measurement.triangles = triangles;
  }
  if (objects > 0) {
    measurement.meshes = objects;
  }
  if (materials.length > 0) {
    measurement.materials = materials;
  }
  return Object.keys(measurement).length > 0 ? measurement : undefined;
}
