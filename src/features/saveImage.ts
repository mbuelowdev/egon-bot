import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { featurePaths } from "../cursor/testReport.js";
import { UserFacingError, type FeatureAttachment, type FeatureStore } from "./store.js";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export type IncomingImage = {
  name: string;
  url: string;
  contentType: string | null;
};

export function assertImageContentType(contentType: string | null): string {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime.startsWith("image/") || !ALLOWED_MIME.has(mime)) {
    throw new UserFacingError("Only PNG, JPEG, GIF, or WebP image attachments are allowed.");
  }
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function extensionFor(name: string, mimeType: string): string {
  const fromName = extname(name).toLowerCase();
  if (fromName === ".png" || fromName === ".jpg" || fromName === ".jpeg" || fromName === ".gif" || fromName === ".webp") {
    return fromName;
  }
  return MIME_EXT[mimeType] ?? ".png";
}

export async function saveFeatureImage(
  options: {
    dataDir: string;
    store: FeatureStore;
    featureId: number;
    image: IncomingImage;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<FeatureAttachment> {
  const mimeType = assertImageContentType(options.image.contentType);
  const storedName = `${randomUUID()}${extensionFor(options.image.name, mimeType)}`;
  const dir = featurePaths(options.dataDir, options.featureId).attachmentsDir;
  mkdirSync(dir, { recursive: true });
  let response: Response;
  try {
    response = await fetchImpl(options.image.url);
  } catch {
    throw new UserFacingError("Could not download the attached image.");
  }
  if (!response.ok) {
    throw new UserFacingError("Could not download the attached image.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(dir, storedName), buffer);
  const filename = options.image.name.trim() === "" ? storedName : options.image.name;
  return options.store.addAttachment(options.featureId, { filename, mimeType, storedName });
}
