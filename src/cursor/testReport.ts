import { join } from "node:path";

export type CriterionResult = {
  index: number;
  status: "PASS" | "FAIL";
  text: string;
};

export type TestReport = {
  overallPass: boolean;
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
  return items;
}

export function parseTestReport(raw: string): TestReport {
  const criteria: CriterionResult[] = [];
  const lineRe =
    /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:(\d+)[\.\):]\s*)?(?:criterion\s+\d+[:\s]+)?\[?\s*(PASS|FAIL)\s*\]?\s*[:\-]?\s*(.*)$/gim;
  for (const match of raw.matchAll(lineRe)) {
    const status = match[2]?.toUpperCase() === "PASS" ? "PASS" : "FAIL";
    const text = (match[3] ?? "").trim();
    criteria.push({
      index: match[1] ? Number(match[1]) : criteria.length + 1,
      status,
      text,
    });
  }
  const overallPass = criteria.length > 0 && criteria.every((item) => item.status === "PASS");
  return { overallPass, criteria, raw };
}

export function featurePaths(dataDir: string, featureId: number): {
  root: string;
  screenshotsDir: string;
  reportPath: string;
  specPath: string;
  agentLogPath: string;
} {
  const root = join(dataDir, "features", String(featureId));
  return {
    root,
    screenshotsDir: join(root, "screenshots"),
    reportPath: join(root, "TEST_REPORT.md"),
    specPath: join(root, "SPEC.md"),
    agentLogPath: join(root, "agent-log.jsonl"),
  };
}
