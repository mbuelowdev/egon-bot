import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checksFilePath,
  checksWithMissingScenario,
  listRepoScenarios,
  loadAllChecks,
} from "./regression.js";

function gameRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "egon-checks-"));
  mkdirSync(join(dir, "egon", "checks"), { recursive: true });
  mkdirSync(join(dir, "egon", "scenarios"), { recursive: true });
  return dir;
}

function writeChecks(dir: string, slug: string, checks: unknown[]): void {
  writeFileSync(join(dir, "egon", "checks", `${slug}.json`), JSON.stringify(checks));
}

function check(name: string, scenario = "default"): unknown {
  return {
    name,
    scenario,
    steps: [{ expect: "window.__egon.state().x", equals: 1 }],
  };
}

test("an empty game repo yields no checks and no problems", () => {
  const dir = mkdtempSync(join(tmpdir(), "egon-empty-"));
  assert.deepEqual(loadAllChecks(dir, "dash"), { checks: [], problems: [] });
  assert.deepEqual(listRepoScenarios(dir), []);
});

test("checks load from every feature file on the branch", () => {
  const dir = gameRepo();
  writeChecks(dir, "dash", [check("dash works")]);
  writeChecks(dir, "endgame-screen", [check("victory shows", "endgame_victory")]);
  const loaded = loadAllChecks(dir, "dash");
  assert.deepEqual(loaded.problems, []);
  assert.equal(loaded.checks.length, 2);
  // The feature being built runs first so its failures surface before inherited ones.
  assert.equal(loaded.checks[0]?.owner, "dash");
  assert.equal(loaded.checks[0]?.inherited, false);
  assert.equal(loaded.checks[1]?.owner, "endgame-screen");
  assert.equal(loaded.checks[1]?.inherited, true);
});

test("a checks file that no longer parses is a reported problem, never a silent skip", () => {
  // Silently shrinking the suite is how a regression set stops catching regressions.
  const dir = gameRepo();
  writeChecks(dir, "dash", [check("dash works")]);
  writeFileSync(join(dir, "egon", "checks", "broken.json"), "{ not json");
  const loaded = loadAllChecks(dir, "dash");
  assert.equal(loaded.checks.length, 1);
  assert.ok(loaded.problems.some((problem) => problem.startsWith("broken.json:")));
});

test("scenarios are listed from their file names", () => {
  const dir = gameRepo();
  writeFileSync(join(dir, "egon", "scenarios", "endgame_victory.gd"), "## Victory screen.\n");
  writeFileSync(join(dir, "egon", "scenarios", "default.gd"), "## Normal boot.\n");
  writeFileSync(join(dir, "egon", "scenarios", "notes.txt"), "ignored");
  assert.deepEqual(listRepoScenarios(dir), ["default", "endgame_victory"]);
});

test("a check whose scenario is not registered is flagged, not dropped", () => {
  const dir = gameRepo();
  writeChecks(dir, "endgame-screen", [check("victory shows", "endgame_victory")]);
  writeChecks(dir, "dash", [check("dash works")]);
  const loaded = loadAllChecks(dir, "dash");
  const missing = checksWithMissingScenario(loaded.checks, []);
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.check.scenario, "endgame_victory");
  // `default` is always available even with no scenario file.
  assert.equal(checksWithMissingScenario(loaded.checks, ["endgame_victory"]).length, 0);
});

test("the checks path is derived from the feature slug", () => {
  assert.equal(checksFilePath("/game", "dash-hud"), join("/game", "egon", "checks", "dash-hud.json"));
});
