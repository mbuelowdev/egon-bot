/**
 * `file` reports `glTF model, version 2` and stops. The bounding box is the single most
 * placement-critical number in the library — whether the truck is 5 m or 0.05 m decides
 * whether the implementer has to scale it — and a human will not type it accurately, so
 * models get a real reader. The glTF spec requires `min`/`max` on `POSITION` accessors,
 * which makes the box a lookup rather than a mesh walk.
 *
 * Nothing here throws. A truncated or hand-edited model is stored with no measurements
 * rather than failing the upload; the description is the required part.
 */

const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const TRIANGLES_MODE = 4;

export type ModelMeasurement = {
  bboxMeters?: [number, number, number];
  triangles?: number;
  meshes?: number;
  nodes?: string[];
  materials?: string[];
  animations?: string[];
};

type GltfAccessor = { count?: number; min?: unknown; max?: unknown };
type GltfPrimitive = { attributes?: Record<string, number>; indices?: number; mode?: number };
type GltfDocument = {
  accessors?: GltfAccessor[];
  meshes?: Array<{ name?: string; primitives?: GltfPrimitive[] }>;
  nodes?: Array<{ name?: string }>;
  materials?: Array<{ name?: string }>;
  animations?: Array<{ name?: string }>;
};

/** JSON chunk of a GLB container: 12-byte header, then chunk 0 is the document. */
export function readGlbJson(buffer: Buffer): string | undefined {
  if (buffer.length < GLB_HEADER_BYTES || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    return undefined;
  }
  const chunkLength = buffer.length >= GLB_HEADER_BYTES + 8 ? buffer.readUInt32LE(GLB_HEADER_BYTES) : 0;
  const chunkType = buffer.length >= GLB_HEADER_BYTES + 8 ? buffer.readUInt32LE(GLB_HEADER_BYTES + 4) : 0;
  if (chunkType !== GLB_CHUNK_JSON || chunkLength === 0) {
    return undefined;
  }
  const start = GLB_HEADER_BYTES + 8;
  const end = start + chunkLength;
  if (end > buffer.length) {
    return undefined;
  }
  return buffer.toString("utf8", start, end);
}

function parseDocument(raw: string): GltfDocument | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as GltfDocument;
  } catch {
    return undefined;
  }
}

function vec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }
  const out: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const n = value[i];
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return undefined;
    }
    out.push(n);
  }
  return [out[0] as number, out[1] as number, out[2] as number];
}

function names(items: Array<{ name?: string }> | undefined): string[] | undefined {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const out = items
    .map((item, index) => (typeof item?.name === "string" && item.name !== "" ? item.name : `#${String(index)}`))
    .filter((name) => name !== "");
  return out.length > 0 ? out : undefined;
}

function roundMeters(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Union of every `POSITION` accessor's declared min/max. No node transforms are applied. */
export function measureGltfDocument(document: GltfDocument): ModelMeasurement {
  const accessors = Array.isArray(document.accessors) ? document.accessors : [];
  const meshes = Array.isArray(document.meshes) ? document.meshes : [];
  let min: [number, number, number] | undefined;
  let max: [number, number, number] | undefined;
  let triangles = 0;
  let sawTriangles = false;
  for (const mesh of meshes) {
    for (const primitive of Array.isArray(mesh.primitives) ? mesh.primitives : []) {
      const positionIndex = primitive.attributes?.POSITION;
      const position = typeof positionIndex === "number" ? accessors[positionIndex] : undefined;
      const lo = vec3(position?.min);
      const hi = vec3(position?.max);
      if (lo && hi) {
        min = min ? [Math.min(min[0], lo[0]), Math.min(min[1], lo[1]), Math.min(min[2], lo[2])] : lo;
        max = max ? [Math.max(max[0], hi[0]), Math.max(max[1], hi[1]), Math.max(max[2], hi[2])] : hi;
      }
      const mode = primitive.mode ?? TRIANGLES_MODE;
      if (mode !== TRIANGLES_MODE) {
        continue;
      }
      const indexAccessor = typeof primitive.indices === "number" ? accessors[primitive.indices] : undefined;
      const count = indexAccessor?.count ?? position?.count;
      if (typeof count === "number" && Number.isFinite(count) && count >= 3) {
        triangles += Math.floor(count / 3);
        sawTriangles = true;
      }
    }
  }
  const measurement: ModelMeasurement = {};
  if (min && max) {
    measurement.bboxMeters = [
      roundMeters(max[0] - min[0]),
      roundMeters(max[1] - min[1]),
      roundMeters(max[2] - min[2]),
    ];
  }
  if (sawTriangles) {
    measurement.triangles = triangles;
  }
  if (meshes.length > 0) {
    measurement.meshes = meshes.length;
  }
  const nodeNames = names(document.nodes);
  if (nodeNames) {
    measurement.nodes = nodeNames;
  }
  const materialNames = names(document.materials);
  if (materialNames) {
    measurement.materials = materialNames;
  }
  const animationNames = names(document.animations);
  if (animationNames) {
    measurement.animations = animationNames;
  }
  return measurement;
}

/** A `.glb` container or a `.gltf` document. Returns nothing when neither parses. */
export function measureGltf(buffer: Buffer): ModelMeasurement | undefined {
  try {
    const raw = readGlbJson(buffer) ?? buffer.toString("utf8");
    const document = parseDocument(raw);
    if (document === undefined) {
      return undefined;
    }
    const measurement = measureGltfDocument(document);
    return Object.keys(measurement).length > 0 ? measurement : undefined;
  } catch {
    return undefined;
  }
}
