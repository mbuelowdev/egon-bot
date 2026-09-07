import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE_NAME = "godot-cli.md";

export const GODOT_CLI_GUIDE_REPO_PATH = `docs/${GUIDE_NAME}`;

/**
 * Short Godot CLI cheat sheet compiled into the implementer prompt.
 * The full reference stays at docs/godot-cli.md and is copied into the
 * game repo for on-demand Read. Do not inject that file verbatim.
 */
export const GODOT_CLI_GUIDE = [
  "# Godot CLI",
  "",
  "Godot **4.7.2** editor binary (`godot`). Always `--headless --path .`. Never `--test`, `--editor`/`-e`, or `--debug` unattended.",
  "",
  "```bash",
  "godot --headless --path . --import",
  "godot --headless --path . --script res://path/to/script.gd --check-only",
  "godot --headless --path . --quit-after 60 --log-file /tmp/godot-run.log",
  "godot --headless --path . --scene res://path/to/scene.tscn --quit-after 60 --log-file /tmp/godot-scene.log",
  'rg -n --max-count 20 "SCRIPT ERROR|ERROR:|WARNING:|Parse Error|Compile Error" /tmp/godot-run.log',
  "```",
  "",
  "Always `rg -n --max-count 20`. Never `cat` a Godot log.",
  "Loop: import → parse-check changed `.gd` only → smoke-run → grep log. Do not Web-export.",
  "Full commands and expect-conditions: `docs/godot-cli.md`.",
].join("\n");

function godotCliGuidePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "docs", GUIDE_NAME),
    join(here, GUIDE_NAME),
    join(process.cwd(), "docs", GUIDE_NAME),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  throw new Error(`Missing Godot CLI guide (docs/${GUIDE_NAME})`);
}

export function loadGodotCliGuideMarkdown(): string {
  return readFileSync(godotCliGuidePath(), "utf8").trim();
}

/** Copy the full CLI guide into the game tree so the implementer can Read it. */
export function ensureGodotCliGuide(gameRepoDir: string): void {
  const destDir = join(gameRepoDir, "docs");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(godotCliGuidePath(), join(gameRepoDir, GODOT_CLI_GUIDE_REPO_PATH));
}
