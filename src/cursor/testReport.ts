import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MAX_ACCEPTANCE_CRITERIA = 3;

/** Implicit tester check: no Godot SCRIPT ERROR in the browser console. Not a SPEC §7 item. */
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
  const headingRe = /^#{1,3}\s*(?:\d+\.\s*)?acceptance criteria\s*$/im;
  const headingMatch = headingRe.exec(markdown);
  let section: string;
  if (headingMatch?.index === undefined) {
    section = markdown;
  } else {
    const hashes = headingMatch[0].match(/^#+/)?.[0] ?? "##";
    const rest = markdown.slice(headingMatch.index + headingMatch[0].length);
    const nextHeading = new RegExp(`^#{1,${String(hashes.length)}}\\s+`, "m");
    const next = nextHeading.exec(rest);
    section = next?.index === undefined ? rest : rest.slice(0, next.index);
  }
  const items: string[] = [];
  for (const match of section.matchAll(/^\s*(?:\d+[\.\)]\s+|[-*]\s+\d+[\.\)]\s+|[-*]\s+)(.+?)\s*$/gm)) {
    const line = match[1]?.trim() ?? "";
    if (line === "" || /^(?:\d+\.\s*)?acceptance criteria$/i.test(line)) {
      continue;
    }
    items.push(line);
  }
  return items.slice(0, MAX_ACCEPTANCE_CRITERIA);
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

/** Proof shots only: criterion-1.png … criterion-N.png in order. Ignores Playwright dumps. */
export function listCriterionScreenshots(screenshotsDir: string): string[] {
  if (!existsSync(screenshotsDir)) {
    return [];
  }
  const found = new Map<number, string>();
  for (const name of readdirSync(screenshotsDir)) {
    const match = name.match(CRITERION_SCREENSHOT);
    if (!match || match[1] === undefined) {
      continue;
    }
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 1 || index > MAX_ACCEPTANCE_CRITERIA) {
      continue;
    }
    found.set(index, name);
  }
  const names: string[] = [];
  for (let index = 1; index <= MAX_ACCEPTANCE_CRITERIA; index += 1) {
    const name = found.get(index);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
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
