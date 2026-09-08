import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { featurePaths } from "./testReport.js";

/** Reminder for follow-up sends; the first turn already has the full template. */
export const IMPLEMENTER_SUMMARY_REMINDER =
  "End with the structured final message (Files changed / Criteria self-verified / Deviations).";

export const IMPLEMENTER_SUMMARY_PROMPT = [
  "End with a structured final message the orchestrator gives the tester. Use these headings exactly:",
  "",
  "Files changed:",
  "- path — one line per modified or created file",
  "",
  "Criteria self-verified:",
  "1. [PASS] or [FAIL] evidence from EgonBridge.snapshot() in a headless run / Godot CLI (same numbering as Acceptance criteria). You have no browser: never claim window.__egon.state() evidence.",
  "",
  "Deviations:",
  "- none, or justify any file the SPEC's Relevant files section does not list, and any unmet criterion",
].join("\n");

export function persistImplementerSummary(
  dataDir: string,
  featureId: number,
  text: string | undefined,
): void {
  const paths = featurePaths(dataDir, featureId);
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(paths.implementerSummaryPath, text ?? "", "utf8");
}

export function loadImplementerSummary(dataDir: string, featureId: number): string | undefined {
  try {
    const text = readFileSync(featurePaths(dataDir, featureId).implementerSummaryPath, "utf8");
    return text.trim() === "" ? undefined : text;
  } catch {
    return undefined;
  }
}
