/**
 * The server-side gate on what may enter the asset library. The browser checks the same
 * list at drop time, but that is a convenience: a rejection has to hold when someone
 * renames `boss.fbx` to `boss.glb`, so the decision is made on the file's contents
 * (magic bytes and `file`'s mime type) and only then on the extension.
 */

export type AssetKind = "image" | "model" | "audio" | "font";

export const ASSET_KINDS: readonly AssetKind[] = ["image", "model", "audio", "font"];

export const ACCEPTED_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  model: [".glb", ".gltf", ".obj"],
  audio: [".ogg", ".wav", ".mp3"],
  font: [".ttf", ".otf", ".woff2"],
};

/** Mime types `file --mime-type` may report for an accepted extension. */
const EXTENSION_MIMES: Record<string, readonly string[]> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".glb": ["model/gltf-binary", "application/octet-stream"],
  ".gltf": ["model/gltf+json", "application/json", "text/plain"],
  ".obj": ["text/plain", "model/obj"],
  ".ogg": ["audio/ogg", "application/ogg", "video/ogg"],
  ".wav": ["audio/x-wav", "audio/wav", "audio/vnd.wave", "audio/wave"],
  ".mp3": ["audio/mpeg", "audio/mp3", "audio/x-mpeg"],
  ".ttf": ["font/ttf", "font/sfnt", "application/x-font-ttf", "application/font-sfnt"],
  ".otf": ["font/otf", "font/sfnt", "application/vnd.ms-opentype", "application/x-font-otf"],
  ".woff2": ["font/woff2", "application/font-woff2"],
};

const FBX_REASON = "Needs FBX2glTF, which is not installed. Export `.glb` from Blender.";
const BLEND_REASON = "Needs Blender, which is not installed. Export `.glb`.";
const LAYERED_REASON = "Layered source formats are not game assets. Export a PNG.";
const ASEPRITE_REASON = "Needs the Aseprite CLI, which is not installed. Export a PNG sheet.";
const ARCHIVE_REASON = "Archives are not indexable. Unpack and upload the files.";
const GODOT_REASON = "Godot project files belong in the game repo, not the asset library.";

/** Extensions we recognise well enough to say what to do instead. */
export const REJECTED_EXTENSIONS: Record<string, string> = {
  ".fbx": FBX_REASON,
  ".blend": BLEND_REASON,
  ".psd": LAYERED_REASON,
  ".ai": LAYERED_REASON,
  ".xcf": LAYERED_REASON,
  ".aseprite": ASEPRITE_REASON,
  ".ase": ASEPRITE_REASON,
  ".zip": ARCHIVE_REASON,
  ".rar": ARCHIVE_REASON,
  ".7z": ARCHIVE_REASON,
  ".tres": GODOT_REASON,
  ".tscn": GODOT_REASON,
  ".gd": GODOT_REASON,
  ".import": GODOT_REASON,
};

type Signature = { label: string; reason: string; match: (head: Buffer) => boolean };

function startsWith(head: Buffer, magic: string | number[], offset = 0): boolean {
  const bytes = typeof magic === "string" ? [...Buffer.from(magic, "latin1")] : magic;
  if (head.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, i) => head[offset + i] === byte);
}

/**
 * Content signatures, checked before the extension. `file` reports several of these as
 * `application/octet-stream`, so the mime type alone cannot name the format the human
 * actually dropped — and naming it is the whole point of the rejection message.
 */
const SIGNATURES: Signature[] = [
  { label: "FBX", reason: FBX_REASON, match: (head) => startsWith(head, "Kaydara FBX Binary") },
  { label: "Blender", reason: BLEND_REASON, match: (head) => startsWith(head, "BLENDER") },
  { label: "Photoshop", reason: LAYERED_REASON, match: (head) => startsWith(head, "8BPS") },
  { label: "GIMP", reason: LAYERED_REASON, match: (head) => startsWith(head, "gimp xcf") },
  {
    label: "Aseprite",
    reason: ASEPRITE_REASON,
    match: (head) => head.length >= 6 && head.readUInt16LE(4) === 0xa5e0,
  },
  {
    label: "Zip",
    reason: ARCHIVE_REASON,
    match: (head) => startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]),
  },
  { label: "RAR", reason: ARCHIVE_REASON, match: (head) => startsWith(head, "Rar!\x1a\x07") },
  {
    label: "7-Zip",
    reason: ARCHIVE_REASON,
    match: (head) => startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  },
];

export function assetExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) {
    return "";
  }
  return filename.slice(dot).toLowerCase();
}

export function kindForExtension(ext: string): AssetKind | undefined {
  for (const kind of ASSET_KINDS) {
    if (ACCEPTED_EXTENSIONS[kind].includes(ext)) {
      return kind;
    }
  }
  return undefined;
}

/** Every accepted extension, for the "Accepted: …" half of a rejection message. */
export function acceptedExtensions(): string[] {
  return ASSET_KINDS.flatMap((kind) => [...ACCEPTED_EXTENSIONS[kind]]);
}

export function acceptedListText(): string {
  return acceptedExtensions().join(" ");
}

export type UploadVerdict =
  | { ok: true; kind: AssetKind; ext: string }
  | { ok: false; reason: string };

/**
 * Decide whether `filename` may enter the library. `head` is the first bytes of the file
 * and `mimeType` is what `file --mime-type` said; both describe contents, so a renamed
 * extension cannot smuggle an unsupported format past this.
 */
export function classifyUpload(options: {
  filename: string;
  head?: Buffer;
  mimeType?: string;
}): UploadVerdict {
  const ext = assetExtension(options.filename);
  const head = options.head ?? Buffer.alloc(0);
  for (const signature of SIGNATURES) {
    if (signature.match(head)) {
      return { ok: false, reason: `This is a ${signature.label} file. ${signature.reason}` };
    }
  }
  const rejected = REJECTED_EXTENSIONS[ext];
  if (rejected !== undefined) {
    return { ok: false, reason: rejected };
  }
  const kind = kindForExtension(ext);
  if (kind === undefined) {
    const named = ext === "" ? "(no extension)" : ext;
    return { ok: false, reason: `Unsupported format ${named}. Accepted: ${acceptedListText()}` };
  }
  const mime = options.mimeType?.trim().toLowerCase();
  const allowed = EXTENSION_MIMES[ext] ?? [];
  if (mime !== undefined && mime !== "" && !allowed.includes(mime)) {
    return {
      ok: false,
      reason: `The contents are ${mime}, which is not a valid ${ext}. Renaming the extension does not convert the file.`,
    };
  }
  return { ok: true, kind, ext };
}
