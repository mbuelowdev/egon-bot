import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import type { FeatureStore } from "../features/store.js";
import { removeExportDir } from "../godot/export.js";
import { stopWebServer } from "../godot/serve.js";
import { bumpVersion, readDeploymentVersion, versionIncreased, writeDeploymentVersion } from "./version.js";
import { git } from "./workingTree.js";

const execFileAsync = promisify(execFile);

export async function readOriginDeploymentVersion(config: Config): Promise<string | undefined> {
  try {
    const raw = await git(config.gameRepoDir, [
      "show",
      `origin/${config.gameRepoBranch}:deployment.json`,
    ]);
    return readDeploymentVersion(raw);
  } catch {
    return undefined;
  }
}

export async function ensureDeploymentBump(config: Config): Promise<string> {
  const path = join(config.gameRepoDir, "deployment.json");
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "{}";
  const local = readDeploymentVersion(raw);
  const origin = await readOriginDeploymentVersion(config);
  if (local && origin && versionIncreased(local, origin)) {
    return local;
  }
  const next = bumpVersion(local ?? origin);
  writeFileSync(path, writeDeploymentVersion(raw === "{}" && !existsSync(path) ? "{}" : raw, next));
  return next;
}

export async function configureGitIdentity(config: Config): Promise<void> {
  try {
    await execFileAsync("git", ["config", "--global", "user.name", config.gitAuthorName]);
    await execFileAsync("git", ["config", "--global", "user.email", config.gitAuthorEmail]);
  } catch (error) {
    console.error("git config --global failed; commits still pass identity via -c", error);
  }
}

export async function cleanupAfterMerge(
  config: Config,
  store: FeatureStore,
  featureId: number,
): Promise<void> {
  await stopWebServer();
  removeExportDir();
  const feature = store.getFeatureById(featureId);
  if (feature && feature.state !== "accepted") {
    store.transition(featureId, "accepted");
  }
  store.markPendingDeployAnnounce(featureId);
  store.releasePipelineLock();
}
