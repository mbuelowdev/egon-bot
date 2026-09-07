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

export function attachmentPromptLines(
  attachmentsDir: string,
  assetDir: string,
  count: number,
  forImplementer: boolean,
): string[] {
  if (count === 0) {
    return [];
  }
  const noun = count === 1 ? "image is" : "images are";
  const copy = forImplementer
    ? `Those files are already in the working tree at ${assetDir}. Import them into the Godot project from there (do not re-download).`
    : `Those files are also in the working tree at ${assetDir}.`;
  return [
    "",
    `${String(count)} Discord ${noun} attached to this message as vision input.`,
    copy,
    `Original copies remain at ${attachmentsDir}.`,
  ];
}
