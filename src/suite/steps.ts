import type { Check, Comparator, Step } from "../features/checkSchema.js";
import { egonStatePollEvaluateSource, type EgonStatePollResult } from "./statePoll.js";

/**
 * The step executor. Everything here is deterministic: a step runs as written, or the
 * check fails with the reason. There is no agent to retry, reword, or guess, which is
 * why failures carry the expression, the expected value, and the actual value.
 */

/** Minimal surface the runner needs from a page, so steps stay testable without a browser. */
export type SuitePage = {
  evaluate: <T>(source: string) => Promise<T>;
  press: (key: string) => Promise<void>;
  click: (x: number, y: number) => Promise<void>;
  move: (x: number, y: number) => Promise<void>;
  drag: (from: [number, number], to: [number, number]) => Promise<void>;
  screenshot: (fileName: string) => Promise<void>;
  startProofVideo: () => Promise<boolean>;
  stopProofVideo: (fileName: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
};

export type StepOutcome = {
  ok: boolean;
  /** One line describing what ran. Goes into the report either way. */
  detail: string;
  actual?: unknown;
  error?: string;
};

export type CheckOutcome = {
  name: string;
  scenario: string;
  ok: boolean;
  /** 1-based index of the step that failed, when one did. */
  failedStep?: number;
  failure?: string;
  screenshots: string[];
};

function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a !== "object") {
    return false;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** True when `actual` satisfies `comparator` against `expected`. */
export function compareValues(
  comparator: Comparator,
  actual: unknown,
  expected: unknown,
  previous?: unknown,
): { ok: boolean; reason?: string } {
  if (comparator === "equals") {
    return deepEqual(actual, expected)
      ? { ok: true }
      : { ok: false, reason: `expected ${describe(expected)}, actual ${describe(actual)}` };
  }
  if (comparator === "at_least" || comparator === "at_most") {
    if (typeof actual !== "number" || typeof expected !== "number") {
      return {
        ok: false,
        reason: `${comparator} needs numbers, got ${describe(actual)} and ${describe(expected)}`,
      };
    }
    const ok = comparator === "at_least" ? actual >= expected : actual <= expected;
    return ok
      ? { ok: true }
      : { ok: false, reason: `expected ${comparator} ${describe(expected)}, actual ${describe(actual)}` };
  }
  if (comparator === "changed_by") {
    if (typeof actual !== "number" || typeof expected !== "number") {
      return {
        ok: false,
        reason: `changed_by needs numbers, got ${describe(actual)} and ${describe(expected)}`,
      };
    }
    if (typeof previous !== "number") {
      return {
        ok: false,
        reason: "changed_by has no earlier reading of this expression to compare against",
      };
    }
    const delta = actual - previous;
    return delta === expected
      ? { ok: true }
      : {
          ok: false,
          reason: `expected a change of ${describe(expected)}, actual change ${describe(delta)} (${describe(previous)} → ${describe(actual)})`,
        };
  }
  // contains
  if (typeof actual === "string") {
    return actual.includes(String(expected))
      ? { ok: true }
      : { ok: false, reason: `expected to contain ${describe(expected)}, actual ${describe(actual)}` };
  }
  if (Array.isArray(actual)) {
    return actual.some((item) => deepEqual(item, expected))
      ? { ok: true }
      : { ok: false, reason: `expected to contain ${describe(expected)}, actual ${describe(actual)}` };
  }
  return { ok: false, reason: `contains needs a string or array, got ${describe(actual)}` };
}

/**
 * Read one expression through the settle-poll. The bridge pushes a snapshot once per
 * frame, so a read fired straight after an input can observe the frame before it, and
 * anything behind a tween, timer, or physics step needs several more.
 */
async function settleRead(
  page: SuitePage,
  expression: string,
): Promise<EgonStatePollResult<unknown>> {
  const source = `(${egonStatePollEvaluateSource(expression)})()`;
  return page.evaluate<EgonStatePollResult<unknown>>(source);
}

export type StepContext = {
  /** Last settled value per expression, so `changed_by` has a baseline. */
  previous: Map<string, unknown>;
  /** Screenshot file names captured so far, in order. */
  screenshots: string[];
  /** Names a screenshot file for this check. */
  screenshotName: (stepName: string, index: number) => string;
};

export async function runStep(
  page: SuitePage,
  step: Step,
  context: StepContext,
): Promise<StepOutcome> {
  if (step.kind === "press") {
    await page.press(step.key);
    return { ok: true, detail: `press ${step.key}` };
  }
  if (step.kind === "click") {
    await page.click(step.x, step.y);
    return { ok: true, detail: `click ${String(step.x)},${String(step.y)}` };
  }
  if (step.kind === "move") {
    await page.move(step.x, step.y);
    return { ok: true, detail: `move ${String(step.x)},${String(step.y)}` };
  }
  if (step.kind === "drag") {
    await page.drag(step.from, step.to);
    return {
      ok: true,
      detail: `drag ${step.from.join(",")} to ${step.to.join(",")}`,
    };
  }
  if (step.kind === "screenshot") {
    const fileName = context.screenshotName(step.name, context.screenshots.length);
    await page.screenshot(fileName);
    context.screenshots.push(fileName);
    return { ok: true, detail: `screenshot ${fileName}` };
  }

  const deadline = step.kind === "await" ? Date.now() + step.timeoutMs : 0;
  for (;;) {
    const read = await settleRead(page, step.expression);
    if (read.error !== undefined) {
      return {
        ok: false,
        detail: `${step.kind} ${step.expression}`,
        error: `reading ${step.expression} threw: ${read.error}`,
      };
    }
    const previous = context.previous.get(step.expression);
    const verdict = compareValues(step.comparator, read.value, step.value, previous);
    if (verdict.ok) {
      context.previous.set(step.expression, read.value);
      return {
        ok: true,
        detail: `${step.kind} ${step.expression} ${step.comparator} ${describe(step.value)}`,
        actual: read.value,
      };
    }
    if (step.kind === "expect" || Date.now() >= deadline) {
      context.previous.set(step.expression, read.value);
      return {
        ok: false,
        detail: `${step.kind} ${step.expression} ${step.comparator} ${describe(step.value)}`,
        actual: read.value,
        error: verdict.reason ?? "comparison failed",
      };
    }
  }
}

/** Run every step of one check in order, stopping at the first failure. */
export async function runCheckSteps(
  page: SuitePage,
  check: Check,
  context: StepContext,
): Promise<CheckOutcome> {
  for (const [index, step] of check.steps.entries()) {
    const outcome = await runStep(page, step, context);
    if (!outcome.ok) {
      return {
        name: check.name,
        scenario: check.scenario,
        ok: false,
        failedStep: index + 1,
        failure: `${outcome.detail} — ${outcome.error ?? "failed"}`,
        screenshots: context.screenshots,
      };
    }
  }
  return {
    name: check.name,
    scenario: check.scenario,
    ok: true,
    screenshots: context.screenshots,
  };
}
