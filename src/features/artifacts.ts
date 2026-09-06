import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "./slug.js";
import type { Feature } from "./store.js";

export function gameSpecPath(config: Config, feature: Feature): string {
  return join(config.gameRepoDir, "docs", "features", featureSlug(feature.name), "SPEC.md");
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

export function featureBranchName(feature: Feature): string {
  return `egon/${featureSlug(feature.name)}`;
}
