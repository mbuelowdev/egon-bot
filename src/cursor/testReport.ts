import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MAX_ACCEPTANCE_CRITERIA = 3;

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
  const heading = markdown.search(/^#{1,3}\s*acceptance criteria\s*$/im);
  const section = heading === -1 ? markdown : markdown.slice(heading);
  const items: string[] = [];
  for (const match of section.matchAll(/^\s*(?:\d+[\.\)]\s+|[-*]\s+\d+[\.\)]\s+|[-*]\s+)(.+?)\s*$/gm)) {
    const line = match[1]?.trim() ?? "";
    if (line === "" || /^acceptance criteria$/i.test(line)) {
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
  const hasFailure = criteria.some((item) => item.status === "FAIL");
  const overallPass = criteria.length > 0 && !hasFailure;
  return { overallPass, hasFailure, criteria, raw };
}

export function overallTestLabel(report: TestReport): "PASS" | "FAIL" {
  return report.overallPass ? "PASS" : "FAIL";
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
} {
  const root = join(dataDir, "features", String(featureId));
  return {
    root,
    screenshotsDir: join(root, "screenshots"),
    attachmentsDir: join(root, "attachments"),
    reportPath: join(root, "TEST_REPORT.md"),
    specPath: join(root, "SPEC.md"),
    agentLogPath: join(root, "agent-log.jsonl"),
  };
}
