import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { EXPORT_DIR } from "./headers.js";
import { ensureWebExportPreset } from "./preset.js";

const execFileAsync = promisify(execFile);

export async function exportDebugWeb(gameRepoDir: string): Promise<string> {
  ensureWebExportPreset(gameRepoDir);
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  mkdirSync(EXPORT_DIR, { recursive: true });
  const htmlPath = join(EXPORT_DIR, "index.html");
  if (!htmlPath.endsWith(".html")) {
    throw new Error("Godot export path must end in .html");
  }
  try {
    await execFileAsync(
      "godot",
      ["--headless", "--path", gameRepoDir, "--export-debug", "Web", htmlPath],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Godot web export failed: ${detail}`);
  }
  return htmlPath;
}

export function removeExportDir(): void {
  rmSync(EXPORT_DIR, { recursive: true, force: true });
}
