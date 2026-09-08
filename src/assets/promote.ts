import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assetFilePath,
  partFilePath,
  promotedAssetPath,
  promotedPartPath,
  readAssetMeta,
  sha256Hex,
} from "./store.js";

/**
 * Only assets a SPEC names reach the game repo. The library stays in `$DATA_DIR`, so
 * unused assets never bloat git and `godot --import` only ever sees what a feature
 * promoted. Promotion is idempotent by sha256: a file already present with matching
 * content is skipped, never re-copied, so a fix round does not churn the diff.
 *
 * An asset's companion files ride along into the same directory. A `.gltf` references its
 * `.bin` and textures by relative path, so promoting the `.gltf` alone would import a
 * broken model.
 */

export type PromotionResult = {
  /** Repo-relative paths written by this call. */
  copied: string[];
  /** Already present with matching content. */
  skipped: string[];
  /** Declared ids the library does not have. The spec gate should have caught these. */
  missing: string[];
};

/** Copy one file into the repo unless it is already there byte for byte. */
function copyOnce(
  source: string,
  gameRepoDir: string,
  repoRelative: string,
  sha256: string,
  result: PromotionResult,
): void {
  const dest = join(gameRepoDir, repoRelative);
  if (existsSync(dest)) {
    let identical = false;
    try {
      identical = sha256Hex(readFileSync(dest)) === sha256;
    } catch {
      identical = false;
    }
    if (identical) {
      result.skipped.push(repoRelative);
      return;
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  result.copied.push(repoRelative);
}

export function promoteAssets(options: {
  dataDir: string;
  gameRepoDir: string;
  ids: string[];
}): PromotionResult {
  const result: PromotionResult = { copied: [], skipped: [], missing: [] };
  const seen = new Set<string>();
  for (const id of options.ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const meta = readAssetMeta(options.dataDir, id);
    const source = meta ? assetFilePath(options.dataDir, id) : undefined;
    if (!meta || source === undefined || !existsSync(source)) {
      result.missing.push(id);
      continue;
    }
    copyOnce(source, options.gameRepoDir, promotedAssetPath(meta), meta.sha256, result);
    for (const part of meta.parts) {
      const partSource = partFilePath(options.dataDir, meta.id, part.filename);
      if (partSource === undefined || !existsSync(partSource)) {
        result.missing.push(`${meta.id} / ${part.filename}`);
        continue;
      }
      copyOnce(partSource, options.gameRepoDir, promotedPartPath(meta, part.filename), part.sha256, result);
    }
  }
  return result;
}
