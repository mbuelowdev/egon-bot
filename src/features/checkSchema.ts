import { TESTER_VIEWPORT_HEIGHT, TESTER_VIEWPORT_WIDTH } from "../suite/viewport.js";

/**
 * The checks file (`egon/checks/{slug}.json`) is executed by a runner with no agent in
 * the loop, so every ambiguity becomes a crash rather than something an LLM improvises
 * around. This schema is the only thing standing between a malformed check and that
 * runner, and it is checked at the planner gate — before an implement/export/test cycle
 * has been paid for.
 */

export const MAX_CHECKS = 3;
export const DEFAULT_SCENARIO = "default";
export const DEFAULT_AWAIT_TIMEOUT_MS = 5_000;
export const MAX_AWAIT_TIMEOUT_MS = 30_000;

export const PROOF_KINDS = ["screenshot", "video"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];
export const DEFAULT_PROOF: ProofKind = "screenshot";
/** Capped clip for `proof: "video"`. Human proof only — never an assertion. */
export const DEFAULT_RECORD_MS = 8_000;
export const MIN_RECORD_MS = 5_000;
export const MAX_RECORD_MS = 10_000;

export const COMPARATORS = ["equals", "at_least", "at_most", "changed_by", "contains"] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const STEP_KINDS = [
  "press",
  "click",
  "move",
  "drag",
  "await",
  "expect",
  "screenshot",
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** Keys that read like a duration. A suite built on frame timing is a flaky suite. */
const SLEEP_KEYS = ["sleep", "wait", "wait_ms", "delay", "delay_ms", "pause", "duration"];

const SCENARIO_NAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SCREENSHOT_NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i;
const STATE_CALL_RE = /window\s*\.\s*__egon\s*\.\s*state\s*\(\s*\)/;
const STATE_DOT_FIELD_RE =
  /window\s*\.\s*__egon\s*\.\s*state\s*\(\s*\)\s*(?:\?\.|\.)\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
const STATE_INDEX_FIELD_RE =
  /window\s*\.\s*__egon\s*\.\s*state\s*\(\s*\)\s*\[\s*["']([^"']+)["']\s*\]/g;

/**
 * Playwright key names the planner reliably gets wrong. Single characters ("w") and
 * correct names ("Space", "Control") are valid, so only known-bad spellings are listed —
 * a false positive costs a repair round and can end in PLAN_BLOCKED.
 */
const KEY_ALIASES: Record<string, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  ctrl: "Control",
  cmd: "Meta",
  command: "Meta",
  esc: "Escape",
  return: "Enter",
  spacebar: "Space",
  space_bar: "Space",
  del: "Delete",
  pgup: "PageUp",
  pgdn: "PageDown",
  pagedown: "PageDown",
  ins: "Insert",
};

export type Step =
  | { kind: "press"; key: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "move"; x: number; y: number }
  | { kind: "drag"; from: [number, number]; to: [number, number] }
  | { kind: "await"; expression: string; comparator: Comparator; value: unknown; timeoutMs: number }
  | { kind: "expect"; expression: string; comparator: Comparator; value: unknown }
  | { kind: "screenshot"; name: string };

export type Check = {
  name: string;
  scenario: string;
  proof: ProofKind;
  recordMs: number;
  steps: Step[];
};

export type CheckParse = { ok: true; checks: Check[] } | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function coordinateProblems(pair: [number, number], label: string): string[] {
  const [x, y] = pair;
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return [`${label} coordinates must be whole numbers; found ${String(x)},${String(y)}`];
  }
  if (x < 0 || x >= TESTER_VIEWPORT_WIDTH || y < 0 || y >= TESTER_VIEWPORT_HEIGHT) {
    return [
      `${label} coordinates ${String(x)},${String(y)} fall outside the ${String(TESTER_VIEWPORT_WIDTH)}x${String(TESTER_VIEWPORT_HEIGHT)} viewport`,
    ];
  }
  return [];
}

function keyProblems(key: unknown, label: string): string[] {
  if (typeof key !== "string" || key.trim() === "") {
    return [`${label} press must be a Playwright key name`];
  }
  const suggestion = KEY_ALIASES[key.trim().toLowerCase()];
  if (suggestion !== undefined && suggestion.toLowerCase() !== key.trim().toLowerCase()) {
    return [`${label} uses "${key}", which is not a Playwright key name; use "${suggestion}"`];
  }
  return [];
}

function expressionProblems(expression: unknown, label: string): string[] {
  if (typeof expression !== "string" || expression.trim() === "") {
    return [`${label} needs a JavaScript expression string`];
  }
  if (!STATE_CALL_RE.test(expression)) {
    return [
      `${label} expression must read window.__egon.state(); the runner judges from that return, not from pixels`,
    ];
  }
  return [];
}

function comparatorOf(raw: Record<string, unknown>, label: string):
  | { ok: true; comparator: Comparator; value: unknown }
  | { ok: false; problems: string[] } {
  const found = COMPARATORS.filter((name) => name in raw);
  if (found.length === 0) {
    return {
      ok: false,
      problems: [`${label} needs exactly one comparator (${COMPARATORS.join(", ")})`],
    };
  }
  if (found.length > 1) {
    return {
      ok: false,
      problems: [`${label} has more than one comparator: ${found.join(", ")}`],
    };
  }
  const comparator = found[0] as Comparator;
  return { ok: true, comparator, value: raw[comparator] };
}

function timeoutProblems(raw: Record<string, unknown>, label: string): string[] {
  if (!("timeout_ms" in raw)) {
    return [];
  }
  const value = raw.timeout_ms;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return [`${label} timeout_ms must be a positive whole number of milliseconds`];
  }
  if (value > MAX_AWAIT_TIMEOUT_MS) {
    return [`${label} timeout_ms may not exceed ${String(MAX_AWAIT_TIMEOUT_MS)}ms`];
  }
  return [];
}

function parseStep(raw: unknown, label: string): { step?: Step; problems: string[] } {
  if (!isRecord(raw)) {
    return { problems: [`${label} must be an object`] };
  }
  for (const banned of SLEEP_KEYS) {
    if (banned in raw) {
      return {
        problems: [
          `${label} uses "${banned}". Waiting is always a condition (await), never a duration.`,
        ],
      };
    }
  }
  const kinds = STEP_KINDS.filter((kind) => kind in raw);
  if (kinds.length === 0) {
    return {
      problems: [`${label} names no step kind; expected one of ${STEP_KINDS.join(", ")}`],
    };
  }
  if (kinds.length > 1) {
    return { problems: [`${label} names more than one step kind: ${kinds.join(", ")}`] };
  }
  const kind = kinds[0] as StepKind;

  if (kind === "press") {
    const problems = keyProblems(raw.press, label);
    if (problems.length > 0) {
      return { problems };
    }
    return { step: { kind: "press", key: String(raw.press).trim() }, problems: [] };
  }

  if (kind === "click" || kind === "move") {
    const pair = raw[kind];
    if (!isCoordinatePair(pair)) {
      return { problems: [`${label} ${kind} must be [x, y]`] };
    }
    const problems = coordinateProblems(pair, label);
    if (problems.length > 0) {
      return { problems };
    }
    return { step: { kind, x: pair[0], y: pair[1] }, problems: [] };
  }

  if (kind === "drag") {
    const pairs = raw.drag;
    if (!Array.isArray(pairs) || pairs.length !== 2 || !pairs.every(isCoordinatePair)) {
      return { problems: [`${label} drag must be [[x1, y1], [x2, y2]]`] };
    }
    const [from, to] = pairs as [[number, number], [number, number]];
    const problems = [
      ...coordinateProblems(from, `${label} drag start`),
      ...coordinateProblems(to, `${label} drag end`),
    ];
    if (problems.length > 0) {
      return { problems };
    }
    return { step: { kind: "drag", from, to }, problems: [] };
  }

  if (kind === "screenshot") {
    const name = raw.screenshot;
    if (typeof name !== "string" || !SCREENSHOT_NAME_RE.test(name)) {
      return {
        problems: [`${label} screenshot must be a short name like "victory-score"`],
      };
    }
    return { step: { kind: "screenshot", name }, problems: [] };
  }

  const expressionErrors = expressionProblems(raw[kind], label);
  const comparator = comparatorOf(raw, label);
  const timeouts = kind === "await" ? timeoutProblems(raw, label) : [];
  if (kind === "expect" && "timeout_ms" in raw) {
    timeouts.push(`${label} timeout_ms only applies to await`);
  }
  const problems = [
    ...expressionErrors,
    ...(comparator.ok ? [] : comparator.problems),
    ...timeouts,
  ];
  if (problems.length > 0) {
    return { problems };
  }
  const expression = String(raw[kind]);
  if (!comparator.ok) {
    return { problems };
  }
  if (kind === "await") {
    const timeoutMs =
      typeof raw.timeout_ms === "number" ? raw.timeout_ms : DEFAULT_AWAIT_TIMEOUT_MS;
    return {
      step: {
        kind: "await",
        expression,
        comparator: comparator.comparator,
        value: comparator.value,
        timeoutMs,
      },
      problems: [],
    };
  }
  return {
    step: {
      kind: "expect",
      expression,
      comparator: comparator.comparator,
      value: comparator.value,
    },
    problems: [],
  };
}

function parseProof(
  raw: Record<string, unknown>,
  label: string,
): { proof: ProofKind; recordMs: number; problems: string[] } {
  const problems: string[] = [];
  let proof: ProofKind = DEFAULT_PROOF;
  if ("proof" in raw) {
    if (typeof raw.proof !== "string" || !PROOF_KINDS.includes(raw.proof as ProofKind)) {
      problems.push(
        `${label} proof must be ${PROOF_KINDS.map((kind) => `"${kind}"`).join(" or ")}`,
      );
    } else {
      proof = raw.proof as ProofKind;
    }
  }
  if (proof === "screenshot" && "record_ms" in raw) {
    problems.push(`${label} record_ms only applies when proof is "video"`);
  }
  let recordMs = DEFAULT_RECORD_MS;
  if (proof === "video" && "record_ms" in raw) {
    const value = raw.record_ms;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      problems.push(`${label} record_ms must be a whole number of milliseconds`);
    } else if (value < MIN_RECORD_MS || value > MAX_RECORD_MS) {
      problems.push(
        `${label} record_ms must be between ${String(MIN_RECORD_MS)} and ${String(MAX_RECORD_MS)}`,
      );
    } else {
      recordMs = value;
    }
  }
  return { proof, recordMs, problems };
}

function parseCheck(raw: unknown, index: number): { check?: Check; problems: string[] } {
  const label = `Check ${String(index + 1)}`;
  if (!isRecord(raw)) {
    return { problems: [`${label} must be an object with name, scenario, and steps`] };
  }
  const problems: string[] = [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name === "") {
    problems.push(`${label} needs a name`);
  }
  const proofParsed = parseProof(raw, label);
  problems.push(...proofParsed.problems);
  const scenario = typeof raw.scenario === "string" ? raw.scenario.trim() : "";
  if (scenario === "") {
    problems.push(`${label} must name a scenario ("${DEFAULT_SCENARIO}" for a cold boot)`);
  } else if (!SCENARIO_NAME_RE.test(scenario)) {
    problems.push(
      `${label} scenario "${scenario}" must be lower_snake_case letters, digits, and underscores`,
    );
  }
  const rawSteps = raw.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    problems.push(`${label} needs a non-empty steps array`);
    return { problems };
  }
  const steps: Step[] = [];
  rawSteps.forEach((rawStep, stepIndex) => {
    const parsed = parseStep(rawStep, `${label} step ${String(stepIndex + 1)}`);
    problems.push(...parsed.problems);
    if (parsed.step) {
      steps.push(parsed.step);
    }
  });
  if (!steps.some((step) => step.kind === "await" || step.kind === "expect")) {
    problems.push(`${label} never asserts anything; add an await or expect step`);
  }
  // `changed_by` compares against the previous reading of the same expression, so one
  // must exist earlier in the check. Caught here rather than as a runtime failure.
  const read = new Set<string>();
  steps.forEach((step, stepIndex) => {
    if (step.kind !== "await" && step.kind !== "expect") {
      return;
    }
    if (step.comparator === "changed_by" && !read.has(step.expression)) {
      problems.push(
        `${label} step ${String(stepIndex + 1)} uses changed_by without an earlier read of the same expression to compare against`,
      );
    }
    read.add(step.expression);
  });
  if (problems.length > 0) {
    return { problems };
  }
  return {
    check: {
      name,
      scenario,
      proof: proofParsed.proof,
      recordMs: proofParsed.recordMs,
      steps,
    },
    problems: [],
  };
}

/** Parse and validate a whole checks file. Never throws — a bad file is a gate failure. */
export function parseChecksFile(raw: string): CheckParse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [`Checks file is not valid JSON: ${detail}`] };
  }
  if (!Array.isArray(data)) {
    return { ok: false, problems: ["Checks file must be a JSON array of check objects"] };
  }
  if (data.length === 0) {
    return { ok: false, problems: ["Checks file must contain at least one check"] };
  }
  if (data.length > MAX_CHECKS) {
    return {
      ok: false,
      problems: [
        `Checks file has ${String(data.length)} checks; at most ${String(MAX_CHECKS)} are allowed`,
      ],
    };
  }
  const problems: string[] = [];
  const checks: Check[] = [];
  const seen = new Set<string>();
  data.forEach((rawCheck, index) => {
    const parsed = parseCheck(rawCheck, index);
    problems.push(...parsed.problems);
    if (parsed.check) {
      if (seen.has(parsed.check.name)) {
        problems.push(`Two checks share the name "${parsed.check.name}"`);
      }
      seen.add(parsed.check.name);
      checks.push(parsed.check);
    }
  });
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, checks };
}

/** Bridge fields every expression reads. Empty for whole-object reads. */
export function checkStateFields(checks: Check[]): string[] {
  const fields = new Set<string>();
  for (const check of checks) {
    for (const step of check.steps) {
      if (step.kind !== "await" && step.kind !== "expect") {
        continue;
      }
      for (const re of [STATE_DOT_FIELD_RE, STATE_INDEX_FIELD_RE]) {
        re.lastIndex = 0;
        let found: RegExpExecArray | null = re.exec(step.expression);
        while (found) {
          if (found[1] !== undefined && found[1] !== "") {
            fields.add(found[1]);
          }
          found = re.exec(step.expression);
        }
      }
    }
  }
  return [...fields].sort();
}

/** Distinct scenario names the checks drive, in first-seen order. */
export function checkScenarioNames(checks: Check[]): string[] {
  const names: string[] = [];
  for (const check of checks) {
    if (!names.includes(check.scenario)) {
      names.push(check.scenario);
    }
  }
  return names;
}
