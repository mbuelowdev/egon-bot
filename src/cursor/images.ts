import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKImage, SDKUserMessage } from "@cursor/sdk";
import type { FeatureAttachment } from "../features/store.js";
import { featurePaths } from "./testReport.js";

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
  attachments: FeatureAttachment[],
): SDKImage[] {
  const dir = featurePaths(dataDir, featureId).attachmentsDir;
  const images: SDKImage[] = [];
  for (const attachment of attachments) {
    const filePath = join(dir, attachment.storedName);
    if (!existsSync(filePath)) {
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
