import { MAX_ACCEPTANCE_CRITERIA } from "../cursor/testReport.js";
import { SPEC_SHEET_TEMPLATE } from "../cursor/specTemplate.js";

export type SpecValidation = { ok: true } | { ok: false; problems: string[] };

const PLACEHOLDER_RE = /\{[^{}\n]+\}/g;
const HEADING_RE = /^(#{2,3})\s+\S/;
const NUMBERED_ITEM_RE = /^\s*(?:\d+[\.)]\s+|[-*]\s+\d+[\.)]\s+)\S/;
const ACCEPTANCE_HEADING_RE = /^#{1,3}\s*(?:\d+\.\s*)?acceptance criteria\s*$/i;

export function requiredSpecHeadings(template = SPEC_SHEET_TEMPLATE): string[] {
  return template
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => HEADING_RE.test(line));
}

export function templatePlaceholders(template = SPEC_SHEET_TEMPLATE): string[] {
  return [...new Set(template.match(PLACEHOLDER_RE) ?? [])];
}

function headingLines(markdown: string): string[] {
  return markdown
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => HEADING_RE.test(line));
}

function acceptanceCriteriaSection(markdown: string): string | undefined {
  const lines = markdown.replace(/^\uFEFF/, "").split("\n");
  let start = -1;
  let startLevel = 2;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!ACCEPTANCE_HEADING_RE.test(line)) {
      continue;
    }
    start = i + 1;
    startLevel = (line.match(/^#+/)?.[0] ?? "##").length;
    break;
  }
  if (start < 0) {
    return undefined;
  }
  const rest: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const hashes = trimmed.match(/^#+/)?.[0];
    if (hashes && hashes.length <= startLevel && /\s+\S/.test(trimmed.slice(hashes.length))) {
      break;
    }
    rest.push(line);
  }
  return rest.join("\n");
}

export function countNumberedCriteria(markdown: string): number {
  const section = acceptanceCriteriaSection(markdown);
  if (section === undefined) {
    return 0;
  }
  let count = 0;
  for (const line of section.split("\n")) {
    if (NUMBERED_ITEM_RE.test(line)) {
      count += 1;
    }
  }
  return count;
}

export function validateFeatureSpec(markdown: string): SpecValidation {
  const problems: string[] = [];
  const headings = headingLines(markdown);
  const required = requiredSpecHeadings();
  const foundIndexes: number[] = [];
  for (const heading of required) {
    const index = headings.indexOf(heading);
    if (index < 0) {
      problems.push(`Missing heading: ${heading}`);
    } else {
      foundIndexes.push(index);
    }
  }
  if (foundIndexes.some((index, i) => i > 0 && index <= (foundIndexes[i - 1] ?? -1))) {
    problems.push("Required headings are out of order");
  }

  const counted = countNumberedCriteria(markdown);
  if (counted < 1) {
    problems.push(
      `Acceptance criteria must be a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} items (found none)`,
    );
  } else if (counted > MAX_ACCEPTANCE_CRITERIA) {
    problems.push(
      `Acceptance criteria has ${String(counted)} numbered items; at most ${String(MAX_ACCEPTANCE_CRITERIA)} are allowed`,
    );
  }

  const leftovers = new Set<string>();
  for (const placeholder of templatePlaceholders()) {
    if (markdown.includes(placeholder)) {
      leftovers.add(placeholder);
    }
  }
  const generic = markdown.match(/\{placeholders?\}/gi) ?? [];
  for (const match of generic) {
    leftovers.add(match);
  }
  for (const leftover of leftovers) {
    problems.push(`Leftover template placeholder: ${leftover}`);
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true };
}

export function specFixFollowUp(problems: string[]): string {
  return [
    "The SPEC.md you wrote failed a deterministic schema check. Edit ONLY that spec file. Do not commit or push.",
    "Fix every problem below, then end with PLAN_COMPLETE. If you cannot, end with PLAN_BLOCKED.",
    "",
    "Problems:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    `Keep the template headings in this order. Acceptance criteria must be a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} items. Replace every {placeholder} with a concrete decision; do not leave template braces.`,
  ].join("\n");
}

export function specGateFailureMessage(problems: string[]): string {
  return ["SPEC.md failed schema check:", ...problems.map((problem) => `- ${problem}`)].join("\n");
}
