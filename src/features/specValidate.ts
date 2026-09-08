import { MAX_ACCEPTANCE_CRITERIA } from "../cursor/testReport.js";
import { SPEC_SHEET_TEMPLATE } from "../cursor/specTemplate.js";
import {
  DEFAULT_SCENARIO,
  MAX_CHECKS,
  checkScenarioNames,
  checkStateFields,
  parseChecksFile,
} from "./checkSchema.js";
import {
  declaredAssetIds,
  numberedCriteria,
  testScenariosSection,
  verificationHooksSection,
} from "./specSections.js";

export type SpecValidation = { ok: true } | { ok: false; problems: string[] };

const PLACEHOLDER_RE = /\{[^{}\n]+\}/g;
const HEADING_RE = /^(#{2,3})\s+\S/;
const SCENARIO_TOKEN_RE = /[a-z0-9]+(?:_[a-z0-9]+)+/g;
/** Labels from the retired grammar. Steps live in the checks file now, not in Test scenarios. */
const OLD_CRITERION_LABEL_RE = /\b(Keys|Click|JS|Then)\s*:/i;

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
    .replace(/^﻿/, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => HEADING_RE.test(line));
}

export function countNumberedCriteria(markdown: string): number {
  return numberedCriteria(markdown).length;
}

/** Scenario names Test scenarios mentions, so a newly declared one is not treated as unknown. */
export function declaredScenarioNames(markdown: string): string[] {
  const section = testScenariosSection(markdown);
  if (section === undefined) {
    return [];
  }
  return [...new Set(section.match(SCENARIO_TOKEN_RE) ?? [])];
}

function verificationHookProblems(markdown: string, fields: string[]): string[] {
  const section = verificationHooksSection(markdown);
  if (section === undefined || section.trim() === "") {
    return [];
  }
  const problems: string[] = [];
  if (!/window\s*\.\s*__egon/.test(section)) {
    problems.push("Verification hooks must name `window.__egon.state()` as the debug bridge");
  }
  if (!/EgonBridge/.test(section)) {
    problems.push(
      "Verification hooks must register fields on the `EgonBridge` autoload (`get_node(\"/root/EgonBridge\").register_field`)",
    );
  }
  const declared = new Set<string>();
  for (const match of section.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    declared.add(match[0]);
  }
  if (declared.size === 0) {
    return problems;
  }
  for (const field of fields) {
    if (!declared.has(field)) {
      problems.push(
        `A check reads \`window.__egon.state().${field}\`, but Verification hooks never declares a \`${field}\` field`,
      );
    }
  }
  return problems;
}

function testScenarioProblems(markdown: string): string[] {
  const section = testScenariosSection(markdown);
  if (section === undefined || section.trim() === "") {
    return ["Test scenarios must name the scenarios this feature verifies against"];
  }
  if (declaredScenarioNames(markdown).length === 0 && !section.includes(DEFAULT_SCENARIO)) {
    return [
      `Test scenarios names no scenario; use \`${DEFAULT_SCENARIO}\` for a cold boot or declare a new lower_snake_case name`,
    ];
  }
  return [];
}

/**
 * Every id the Assets section names must exist in the library and have a description.
 * Promotion only ever copies declared assets into the repo, so a spec naming one that is
 * not there ships a broken `res://` path — and an undescribed asset is not in the
 * manifest the planner read, which means the id was guessed rather than chosen.
 */
function assetProblems(markdown: string, libraryAssetIds: string[] | undefined): string[] {
  const declared = declaredAssetIds(markdown);
  if (declared.length === 0) {
    return [];
  }
  const known = new Set(libraryAssetIds ?? []);
  return declared
    .filter((id) => !known.has(id))
    .map(
      (id) =>
        `The Assets section names \`${id}\`, which is not a described asset in the library. Name only ids from the asset library index, or write \`None.\``,
    );
}

/** Spec-only checks. The checks file is validated by `validatePlannerOutput`. */
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

  const criteria = numberedCriteria(markdown);
  const counted = criteria.length;
  if (counted < 1) {
    problems.push(
      `Acceptance criteria must be a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} items (found none)`,
    );
  } else if (counted > MAX_ACCEPTANCE_CRITERIA) {
    problems.push(
      `Acceptance criteria has ${String(counted)} numbered items; at most ${String(MAX_ACCEPTANCE_CRITERIA)} are allowed`,
    );
  }
  criteria.forEach((line, index) => {
    if (OLD_CRITERION_LABEL_RE.test(line)) {
      problems.push(
        `Acceptance criterion ${String(index + 1)} carries Keys/Click/JS/Then. Acceptance criteria are plain-language definition of done; executable steps belong in the checks file.`,
      );
    }
  });
  problems.push(...testScenarioProblems(markdown));

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

/**
 * Both planner outputs, gated together. A valid spec with a broken checks file is not
 * complete: the runner has no agent to improvise around a malformed step, so this is the
 * last place a bad check can be caught cheaply.
 */
export function validatePlannerOutput(options: {
  markdown: string;
  checksRaw?: string;
  knownScenarios?: string[];
  libraryAssetIds?: string[];
}): SpecValidation {
  const problems: string[] = [];
  const spec = validateFeatureSpec(options.markdown);
  if (!spec.ok) {
    problems.push(...spec.problems);
  }
  problems.push(...assetProblems(options.markdown, options.libraryAssetIds));
  if (options.checksRaw === undefined) {
    problems.push("Planner did not write the checks file (egon/checks/{slug}.json)");
    return { ok: false, problems };
  }
  const parsed = parseChecksFile(options.checksRaw);
  if (!parsed.ok) {
    problems.push(...parsed.problems);
    return { ok: false, problems };
  }
  const known = new Set([
    DEFAULT_SCENARIO,
    ...(options.knownScenarios ?? []),
    ...declaredScenarioNames(options.markdown),
  ]);
  for (const scenario of checkScenarioNames(parsed.checks)) {
    if (!known.has(scenario)) {
      problems.push(
        `A check names scenario "${scenario}", which the game does not register and Test scenarios never declares`,
      );
    }
  }
  problems.push(...verificationHookProblems(options.markdown, checkStateFields(parsed.checks)));
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true };
}

export function specFixFollowUp(problems: string[]): string {
  return [
    "Your planner output failed a deterministic schema check. Edit ONLY the spec file and the checks file. Do not commit or push.",
    "Fix every problem below, then end with PLAN_COMPLETE. If you cannot, end with PLAN_BLOCKED.",
    "",
    "Problems:",
    ...problems.map((problem) => `- ${problem}`),
    "",
    `Keep the template headings in this order. Acceptance criteria is a numbered list of at most ${String(MAX_ACCEPTANCE_CRITERIA)} plain-language statements — no steps, coordinates, or expressions. Replace every {placeholder} with a concrete decision; do not leave template braces.`,
    `The checks file is a JSON array of at most ${String(MAX_CHECKS)} objects, each { name, scenario, proof, steps }. proof is screenshot or video (default screenshot). Every check names a scenario ("${DEFAULT_SCENARIO}" for a cold boot). Every await/expect expression must read window.__egon.state(), and every field it reads must be declared in Verification hooks.`,
    "Waiting is always a condition (await), never a duration. There is no sleep step. record_ms is only for proof video.",
    "The Assets section may only name ids from the asset library index in your first message. If none fits, write `None.` and draw the placeholder yourself.",
  ].join("\n");
}

export function specGateFailureMessage(problems: string[]): string {
  return ["Planner output failed schema check:", ...problems.map((problem) => `- ${problem}`)].join(
    "\n",
  );
}
