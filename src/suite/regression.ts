import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseChecksFile, type Check } from "../features/checkSchema.js";

/**
 * Checks live in the game repo beside the scenarios they drive, so a revert takes its
 * checks with it and a branch checkout matches checks to code. Nothing here reads a SPEC
 * or touches $DATA_DIR: the working branch is the source of truth.
 */

export const CHECKS_REPO_DIR = "egon/checks";
export const SCENARIOS_REPO_DIR = "egon/scenarios";

export type SuiteCheck = {
  check: Check;
  /** Feature slug that owns this check, from the file name. */
  owner: string;
  /** True when the check came from an already-merged feature, not the one being built. */
  inherited: boolean;
};

export function checksDir(gameRepoDir: string): string {
  return join(gameRepoDir, CHECKS_REPO_DIR);
}

export function checksFilePath(gameRepoDir: string, slug: string): string {
  return join(checksDir(gameRepoDir), `${slug}.json`);
}

export function scenariosDir(gameRepoDir: string): string {
  return join(gameRepoDir, SCENARIOS_REPO_DIR);
}

/** Scenario names the game repo ships, from the file names in egon/scenarios. */
export function listRepoScenarios(gameRepoDir: string): string[] {
  const dir = scenariosDir(gameRepoDir);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".gd"))
    .map((name) => name.slice(0, -3))
    .sort();
}

export type LoadedChecks = {
  checks: SuiteCheck[];
  /** Files that exist but do not parse. Reported, never silently skipped. */
  problems: string[];
};

/**
 * Every check on the branch: the feature being built plus every merged feature's.
 * A file that no longer parses is a problem, not a reason to run fewer checks —
 * silently shrinking the suite is how a regression set stops catching regressions.
 */
export function loadAllChecks(gameRepoDir: string, currentSlug?: string): LoadedChecks {
  const dir = checksDir(gameRepoDir);
  if (!existsSync(dir)) {
    return { checks: [], problems: [] };
  }
  const checks: SuiteCheck[] = [];
  const problems: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const owner = file.slice(0, -5);
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), "utf8");
    } catch (error) {
      problems.push(`${file}: unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const parsed = parseChecksFile(raw);
    if (!parsed.ok) {
      problems.push(...parsed.problems.map((problem) => `${file}: ${problem}`));
      continue;
    }
    for (const check of parsed.checks) {
      checks.push({ check, owner, inherited: owner !== currentSlug });
    }
  }
  // The feature being built runs first so its failures surface before inherited ones.
  checks.sort((a, b) => Number(a.inherited) - Number(b.inherited));
  return { checks, problems };
}

/** Checks whose scenario the game does not register. Broken, never skipped. */
export function checksWithMissingScenario(
  checks: SuiteCheck[],
  registered: string[],
): SuiteCheck[] {
  const known = new Set([...registered, "default"]);
  return checks.filter((entry) => !known.has(entry.check.scenario));
}
