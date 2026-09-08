import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { numberedCriteria } from "../features/specSections.js";

export const MAX_ACCEPTANCE_CRITERIA = 3;

/** Implicit tester check: no Godot SCRIPT ERROR in the browser console. Not a SPEC §9 item. */
export const IMPLICIT_CONSOLE_CRITERION_INDEX = 0;
export const MISSING_CONSOLE_CRITERION_LINE =
  "0. [FAIL] missing implicit console check (no SCRIPT ERROR in console)";

export type CriterionStatus = "PASS" | "FAIL" | "COULD_NOT_VERIFY";

export type CriterionResult = {
  index: number;
  status: CriterionStatus;
  text: string;
};

export type TestReport = {
  overallPass: boolean;
  hasFailure: boolean;
  criteria: CriterionResult[];
  raw: string;
};

export function parseAcceptanceCriteria(markdown: string): string[] {
  return numberedCriteria(markdown).slice(0, MAX_ACCEPTANCE_CRITERIA);
}

function parseCriterionStatus(raw: string): CriterionStatus | undefined {
  const normalized = raw.toUpperCase().replace(/[_\s-]+/g, " ").trim();
  if (normalized === "PASS") {
    return "PASS";
  }
  if (normalized === "FAIL") {
    return "FAIL";
  }
  if (normalized === "COULD NOT VERIFY") {
    return "COULD_NOT_VERIFY";
  }
  return undefined;
}

export function parseTestReport(raw: string): TestReport {
  const criteria: CriterionResult[] = [];
  const lineRe =
    /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:(\d+)[\.\):]\s*)?(?:criterion\s+\d+[:\s]+)?\[?\s*(PASS|FAIL|COULD[_\s-]+NOT[_\s-]+VERIFY)\s*\]?\s*[:\-]?\s*(.*)$/gim;
  for (const match of raw.matchAll(lineRe)) {
    const status = parseCriterionStatus(match[2] ?? "");
    if (status === undefined) {
      continue;
    }
    const text = (match[3] ?? "").trim();
    criteria.push({
      index: match[1] ? Number(match[1]) : criteria.length + 1,
      status,
      text,
    });
  }
  const consoleCheck = criteria.find((item) => item.index === IMPLICIT_CONSOLE_CRITERION_INDEX);
  const hasListedFailure = criteria.some((item) => item.status === "FAIL");
  const consolePassed = consoleCheck?.status === "PASS";
  const hasFailure = hasListedFailure || (criteria.length > 0 && !consolePassed);
  const overallPass = criteria.length > 0 && !hasListedFailure && consolePassed;
  return { overallPass, hasFailure, criteria, raw };
}

/** Prepend a FAIL for implicit criterion 0 when listed checks exist but the console was never marked. */
export function ensureImplicitConsoleCriterion(raw: string): string {
  const report = parseTestReport(raw);
  if (
    report.criteria.some((item) => item.index === IMPLICIT_CONSOLE_CRITERION_INDEX) ||
    report.criteria.length === 0
  ) {
    return raw;
  }
  return `${MISSING_CONSOLE_CRITERION_LINE}\n${raw}`;
}

export function overallTestLabel(report: TestReport): "PASS" | "FAIL" {
  return report.overallPass ? "PASS" : "FAIL";
}

/** Discord / TEST_REPORT.md tag for a parsed status. */
export function criterionStatusLabel(status: CriterionStatus): "PASS" | "FAIL" | "COULD NOT VERIFY" {
  return status === "COULD_NOT_VERIFY" ? "COULD NOT VERIFY" : status;
}

export function unverifiedCount(report: TestReport): number {
  return report.criteria.filter((item) => item.status === "COULD_NOT_VERIFY").length;
}

const CRITERION_SCREENSHOT = /^criterion-(\d+)\.(png|jpe?g|webp)$/i;
const CRITERION_VIDEO = /^criterion-(\d+)\.webm$/i;

/** Discord's default bot upload cap is 10 MB; stay under it so a fat encode does not drop the report. */
export const DISCORD_PROOF_MAX_BYTES = 8 * 1024 * 1024;

function criterionFilesByIndex(
  screenshotsDir: string,
  pattern: RegExp,
): Map<number, string> {
  const found = new Map<number, string>();
  if (!existsSync(screenshotsDir)) {
    return found;
  }
  for (const name of readdirSync(screenshotsDir)) {
    const match = name.match(pattern);
    if (!match || match[1] === undefined) {
      continue;
    }
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1 || index > MAX_ACCEPTANCE_CRITERIA) {
      continue;
    }
    found.set(index, name);
  }
  return found;
}

function orderedCriterionNames(found: Map<number, string>): string[] {
  const names: string[] = [];
  for (let index = 1; index <= MAX_ACCEPTANCE_CRITERIA; index += 1) {
    const name = found.get(index);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

/** Proof stills only: criterion-1.png … criterion-N.png in order. Used as vision on fix rounds. */
export function listCriterionScreenshots(screenshotsDir: string): string[] {
  return orderedCriterionNames(criterionFilesByIndex(screenshotsDir, CRITERION_SCREENSHOT));
}

/**
 * One human-facing proof file per criterion. Prefers the video when both exist.
 * Ignores Playwright dumps and extra check-N-* shots.
 */
export function listCriterionProofs(screenshotsDir: string): string[] {
  const videos = criterionFilesByIndex(screenshotsDir, CRITERION_VIDEO);
  const stills = criterionFilesByIndex(screenshotsDir, CRITERION_SCREENSHOT);
  const found = new Map<number, string>();
  for (let index = 1; index <= MAX_ACCEPTANCE_CRITERIA; index += 1) {
    const video = videos.get(index);
    const still = stills.get(index);
    if (video !== undefined) {
      found.set(index, video);
    } else if (still !== undefined) {
      found.set(index, still);
    }
  }
  return orderedCriterionNames(found);
}

export function isProofVideoName(name: string): boolean {
  return CRITERION_VIDEO.test(name);
}

/** Paths to attach to Discord: video if it fits, otherwise the still. Oversized files are skipped. */
export function listDiscordProofPaths(screenshotsDir: string): string[] {
  if (!existsSync(screenshotsDir)) {
    return [];
  }
  const videos = criterionFilesByIndex(screenshotsDir, CRITERION_VIDEO);
  const stills = criterionFilesByIndex(screenshotsDir, CRITERION_SCREENSHOT);
  const paths: string[] = [];
  for (let index = 1; index <= MAX_ACCEPTANCE_CRITERIA; index += 1) {
    const candidates = [videos.get(index), stills.get(index)].filter(
      (name): name is string => name !== undefined,
    );
    for (const name of candidates) {
      const filePath = join(screenshotsDir, name);
      let size = 0;
      try {
        size = statSync(filePath).size;
      } catch {
        continue;
      }
      if (size > DISCORD_PROOF_MAX_BYTES) {
        console.error(`skipping oversized proof ${filePath} (${String(size)} bytes)`);
        continue;
      }
      paths.push(filePath);
      break;
    }
  }
  return paths;
}

export function featurePaths(dataDir: string, featureId: number): {
  root: string;
  screenshotsDir: string;
  attachmentsDir: string;
  reportPath: string;
  specPath: string;
  agentLogPath: string;
  implementerSummaryPath: string;
} {
  const root = join(dataDir, "features", String(featureId));
  return {
    root,
    screenshotsDir: join(root, "screenshots"),
    attachmentsDir: join(root, "attachments"),
    reportPath: join(root, "TEST_REPORT.md"),
    specPath: join(root, "SPEC.md"),
    agentLogPath: join(root, "agent-log.jsonl"),
    implementerSummaryPath: join(root, "IMPLEMENT_SUMMARY.md"),
  };
}
