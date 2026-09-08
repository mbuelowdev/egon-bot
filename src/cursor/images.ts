import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { SDKImage, SDKUserMessage } from "@cursor/sdk";
import { featurePaths, listCriterionScreenshots } from "./testReport.js";

export type CursorImageFile = {
  storedName: string;
  mimeType: string;
};

function mimeForImageName(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/png";
}

function storedImagePath(
  dataDir: string,
  featureId: number,
  storedName: string,
): string | undefined {
  if (storedName === "" || storedName.includes("/") || storedName.includes("\\")) {
    return undefined;
  }
  const paths = featurePaths(dataDir, featureId);
  const inAttachments = join(paths.attachmentsDir, storedName);
  if (existsSync(inAttachments)) {
    return inAttachments;
  }
  const inScreenshots = join(paths.screenshotsDir, storedName);
  if (existsSync(inScreenshots)) {
    return inScreenshots;
  }
  return undefined;
}

export function criterionScreenshotAttachments(
  dataDir: string,
  featureId: number,
): CursorImageFile[] {
  const { screenshotsDir } = featurePaths(dataDir, featureId);
  return listCriterionScreenshots(screenshotsDir).map((name) => ({
    storedName: name,
    mimeType: mimeForImageName(name),
  }));
}

export function logTextForMessage(message: string | SDKUserMessage): string {
  if (typeof message === "string") {
    return message;
  }
  const n = message.images?.length ?? 0;
  if (n === 0) {
    return message.text;
  }
  return `${message.text}\n(${String(n)} ${n === 1 ? "image" : "images"})`;
}

export function agentUserMessage(text: string, images: SDKImage[]): string | SDKUserMessage {
  if (images.length === 0) {
    return text;
  }
  return { text, images };
}

export function loadCursorImages(
  dataDir: string,
  featureId: number,
  attachments: CursorImageFile[],
): SDKImage[] {
  const images: SDKImage[] = [];
  for (const attachment of attachments) {
    const filePath = storedImagePath(dataDir, featureId, attachment.storedName);
    if (filePath === undefined) {
      continue;
    }
    images.push({
      data: readFileSync(filePath).toString("base64"),
      mimeType: attachment.mimeType,
    });
  }
  return images;
}

/**
 * Discord images are reference material, never game content. The portal is the only
 * intake for a file that ships. This instruction used to say the opposite — that the
 * files were already in the working tree and should be imported from there — and an
 * agent handed an image will otherwise still try to make it game content, except now the
 * file is not even on disk in the repo.
 */
export function attachmentPromptLines(
  attachmentsDir: string,
  count: number,
  forImplementer: boolean,
): string[] {
  if (count === 0) {
    return [];
  }
  const noun = count === 1 ? "image is" : "images are";
  const audience = forImplementer
    ? "Build what they describe using the library assets the SPEC's Assets section names, or with primitives you draw yourself."
    : "If a reference image implies this feature needs real art, look for it in the asset library index and name it in the Assets section. If nothing in the library fits, say so in Implementation notes rather than inventing a filename.";
  return [
    "",
    `${String(count)} Discord ${noun} attached to this message as vision input.`,
    'They are **reference material only** — art direction, mockups, "make it look like this".',
    "They are not in the working tree and must not be imported, copied, or referenced by any `res://` path.",
    audience,
    `Original copies remain at ${attachmentsDir}.`,
  ];
}
