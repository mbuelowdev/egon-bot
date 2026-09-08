import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_NAME = "egon_bridge.gd";

export const EGON_BRIDGE_AUTOLOAD = "EgonBridge";
export const EGON_BRIDGE_REPO_PATH = "egon/egon_bridge.gd";
/** Scenario scripts. The file name is the scenario name. */
export const EGON_SCENARIOS_REPO_DIR = "egon/scenarios";
/** Machine-executable checks, one file per feature slug. */
export const EGON_CHECKS_REPO_DIR = "egon/checks";
export const DEFAULT_SCENARIO = "default";
export const EGON_BRIDGE_AUTOLOAD_VALUE = `*res://${EGON_BRIDGE_REPO_PATH}`;

function egonBridgeTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates", TEMPLATE_NAME),
    join(here, TEMPLATE_NAME),
    join(process.cwd(), "templates", TEMPLATE_NAME),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  throw new Error(`Missing Egon bridge autoload (templates/${TEMPLATE_NAME})`);
}

export function loadEgonBridgeScript(): string {
  return readFileSync(egonBridgeTemplatePath(), "utf8");
}

function sectionBounds(lines: string[], header: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    return undefined;
  }
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\[[^\]]+\]\s*$/.test(lines[i]?.trim() ?? "")) {
      return { start, end: i };
    }
  }
  return { start, end: lines.length };
}

/**
 * Add or correct one `[autoload]` entry, leaving the rest of project.godot byte-identical.
 * Godot rewrites this file itself, so a full parse-and-reserialize would churn the diff
 * on every run; this only touches the one line it owns.
 */
export function upsertAutoload(projectGodot: string, name: string, value: string): string {
  const entry = `${name}="${value}"`;
  const lines = projectGodot.split("\n");
  const bounds = sectionBounds(lines, "[autoload]");
  if (!bounds) {
    const body = projectGodot.trimEnd();
    const prefix = body === "" ? "" : `${body}\n\n`;
    return `${prefix}[autoload]\n\n${entry}\n`;
  }
  const keyRe = new RegExp(`^\\s*${name}\\s*=`);
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    if (!keyRe.test(lines[i] ?? "")) {
      continue;
    }
    if ((lines[i] ?? "").trim() === entry) {
      return projectGodot;
    }
    lines[i] = entry;
    return lines.join("\n");
  }
  let insertAt = bounds.end;
  while (insertAt > bounds.start + 1 && (lines[insertAt - 1] ?? "").trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, entry);
  return lines.join("\n");
}

/**
 * Install the debug-bridge autoload into the game tree. Idempotent, and authoritative:
 * the script is overwritten every run so a feature cannot quietly fork it, which is what
 * keeps `window.__egon.state()` cumulative across features instead of per-feature.
 */
export function ensureEgonBridge(gameRepoDir: string): void {
  // The suite globs these directories, so they must exist even before the first
  // scenario or check lands — an absent directory would read as "no checks".
  for (const dir of [EGON_SCENARIOS_REPO_DIR, EGON_CHECKS_REPO_DIR]) {
    mkdirSync(join(gameRepoDir, dir), { recursive: true });
  }
  const scriptPath = join(gameRepoDir, EGON_BRIDGE_REPO_PATH);
  const script = loadEgonBridgeScript();
  const current = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : undefined;
  if (current !== script) {
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, script, "utf8");
  }
  const projectPath = join(gameRepoDir, "project.godot");
  if (!existsSync(projectPath)) {
    return;
  }
  const project = readFileSync(projectPath, "utf8");
  const next = upsertAutoload(project, EGON_BRIDGE_AUTOLOAD, EGON_BRIDGE_AUTOLOAD_VALUE);
  if (next !== project) {
    writeFileSync(projectPath, next, "utf8");
  }
}
