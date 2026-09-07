import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { EXPORT_DIR } from "./headers.js";
import { ensureWebExportPreset } from "./preset.js";

const execFileAsync = promisify(execFile);

/** Keep the tail — Godot's actual error is usually last. */
export const MAX_GODOT_EXPORT_LOG = 32_000;

export class GodotExportError extends Error {
  readonly output: string;

  constructor(output: string) {
    const clipped = clipGodotOutput(output);
    super(`Godot web export failed: ${clipped}`);
    this.name = "GodotExportError";
    this.output = clipped;
  }
}

export function clipGodotOutput(text: string, maxChars = MAX_GODOT_EXPORT_LOG): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `…(truncated)\n${trimmed.slice(-maxChars)}`;
}

export function godotCommandOutput(error: unknown): string {
  const err = error as { stdout?: string; stderr?: string; message?: string };
  const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
  const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
  if (stderr !== "" && stdout !== "") {
    return `${stderr}\n${stdout}`;
  }
  if (stderr !== "") {
    return stderr;
  }
  if (stdout !== "") {
    return stdout;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function exportDebugWeb(gameRepoDir: string, signal?: AbortSignal): Promise<string> {
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
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024, signal },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new GodotExportError(godotCommandOutput(error));
  }
  return htmlPath;
}

export function removeExportDir(): void {
  rmSync(EXPORT_DIR, { recursive: true, force: true });
}
