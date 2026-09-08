import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { featurePaths } from "../cursor/testReport.js";
import { featureSlug } from "./slug.js";
import { specGateFailureMessage, validatePlannerOutput, type SpecValidation } from "./specValidate.js";
import { checksFilePath, listRepoScenarios } from "../suite/regression.js";
import { describedAssets } from "../assets/store.js";
import type { Feature } from "./store.js";

export function gameSpecPath(config: Config, feature: Feature): string {
  return join(config.gameRepoDir, "docs", "features", featureSlug(feature.name), "SPEC.md");
}

export function gameChecksPath(config: Config, feature: Feature): string {
  return checksFilePath(config.gameRepoDir, featureSlug(feature.name));
}

function readIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** Gate both planner outputs together: a valid spec with a broken checks file is not done. */
export function inspectFeatureSpec(config: Config, feature: Feature): SpecValidation {
  const src = gameSpecPath(config, feature);
  if (!existsSync(src)) {
    return { ok: false, problems: [`Planner did not write ${src}`] };
  }
  return validatePlannerOutput({
    markdown: readFileSync(src, "utf8"),
    checksRaw: readIfPresent(gameChecksPath(config, feature)),
    knownScenarios: listRepoScenarios(config.gameRepoDir),
    libraryAssetIds: describedAssets(config.dataDir).map((meta) => meta.id),
  });
}

export function copyFeatureSpec(config: Config, feature: Feature): void {
  const src = gameSpecPath(config, feature);
  if (!existsSync(src)) {
    throw new Error(`Planner did not write ${src}`);
  }
  const inspected = inspectFeatureSpec(config, feature);
  if (!inspected.ok) {
    throw new Error(specGateFailureMessage(inspected.problems));
  }
  const paths = featurePaths(config.dataDir, feature.id);
  mkdirSync(paths.root, { recursive: true });
  copyFileSync(src, paths.specPath);
}

/** UTC stamp down to seconds, e.g. `20260906T173633Z`. */
export function branchTimestamp(date: Date = new Date()): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

export function newFeatureBranchName(slug: string, now: Date = new Date()): string {
  return `egon/${slug}-${branchTimestamp(now)}`;
}

export function featureBranchName(feature: Feature): string {
  if (feature.githubBranch) {
    return feature.githubBranch;
  }
  return `egon/${featureSlug(feature.name)}`;
}
