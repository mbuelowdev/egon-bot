import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "./slug.js";
import type { Feature, FeatureAttachment } from "./store.js";

export function gameSpecPath(config: Config, feature: Feature): string {
  return join(config.gameRepoDir, "docs", "features", featureSlug(feature.name), "SPEC.md");
}

export function featureAssetDir(slug: string): string {
  return join("assets", "egon", slug);
}

export function copyFeatureSpec(config: Config, feature: Feature): void {
  const src = gameSpecPath(config, feature);
  if (!existsSync(src)) {
    throw new Error(`Planner did not write ${src}`);
  }
  const paths = featurePaths(config.dataDir, feature.id);
  mkdirSync(paths.root, { recursive: true });
  copyFileSync(src, paths.specPath);
}

export function safeAssetFileName(filename: string, fallback: string): string {
  const base = basename(filename).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (base !== "" && /[A-Za-z0-9]/.test(base)) {
    return base;
  }
  return basename(fallback);
}

function nextAssetDestName(attachment: FeatureAttachment, used: Set<string>): string {
  let name = safeAssetFileName(attachment.filename, attachment.storedName);
  if (!/[A-Za-z0-9]/.test(name)) {
    name = attachment.storedName;
  }
  if (used.has(name.toLowerCase())) {
    const ext = extname(name);
    const stem = ext === "" ? name : name.slice(0, -ext.length);
    name = `${stem}-${String(attachment.id)}${ext}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Game-repo relative path this attachment will have after copyFeatureAssets. */
export function plannedAssetPath(
  featureName: string,
  attachments: FeatureAttachment[],
  attachmentId: number,
): string | undefined {
  const used = new Set<string>();
  for (const attachment of attachments) {
    const name = nextAssetDestName(attachment, used);
    if (attachment.id === attachmentId) {
      return join(featureAssetDir(featureSlug(featureName)), name);
    }
  }
  return undefined;
}

/** Copy Discord images into the game repo so the implementer can open them in cwd. */
export function copyFeatureAssets(
  config: Config,
  feature: Feature,
  attachments: FeatureAttachment[],
): string[] {
  if (attachments.length === 0) {
    return [];
  }
  const slug = featureSlug(feature.name);
  const destDir = join(config.gameRepoDir, featureAssetDir(slug));
  mkdirSync(destDir, { recursive: true });
  const srcDir = featurePaths(config.dataDir, feature.id).attachmentsDir;
  const used = new Set<string>();
  const copied: string[] = [];
  for (const attachment of attachments) {
    const src = join(srcDir, attachment.storedName);
    if (!existsSync(src)) {
      continue;
    }
    const name = nextAssetDestName(attachment, used);
    copyFileSync(src, join(destDir, name));
    copied.push(join(featureAssetDir(slug), name));
  }
  return copied;
}

export function featureBranchName(feature: Feature): string {
  return `egon/${featureSlug(feature.name)}`;
}
