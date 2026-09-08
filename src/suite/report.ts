import type { CheckOutcome } from "./steps.js";

/**
 * The suite writes TEST_REPORT.md in the same numbered `N. [STATUS] text` shape the rest
 * of the pipeline already parses, so Discord, the catalog, and the fix loop need no
 * special case. `COULD NOT VERIFY` simply never appears: a deterministic step either
 * executes and asserts, or it fails with a reason.
 */

export const CONSOLE_CHECK_PASS = "0. [PASS] no SCRIPT ERROR in console";
export const CONSOLE_CHECK_FAIL = "0. [FAIL] SCRIPT ERROR in console";

export type SuiteCheckResult = CheckOutcome & {
  owner: string;
  inherited: boolean;
};

export type SuiteResult = {
  results: SuiteCheckResult[];
  scriptErrors: string[];
  consoleErrors: string[];
  /** Set when the suite could not run at all (no build, no browser, nothing registered). */
  fatal?: string;
};

export function suitePassed(result: SuiteResult): boolean {
  if (result.fatal !== undefined) {
    return false;
  }
  if (result.scriptErrors.length > 0) {
    return false;
  }
  return result.results.length > 0 && result.results.every((entry) => entry.ok);
}

function checkLine(entry: SuiteCheckResult, index: number): string {
  const status = entry.ok ? "PASS" : "FAIL";
  const scope = entry.inherited ? `, inherited from ${entry.owner}` : "";
  const head = `${String(index)}. [${status}] ${entry.name} (scenario: ${entry.scenario}${scope})`;
  if (entry.ok) {
    return head;
  }
  const step = entry.failedStep === undefined ? "" : ` step ${String(entry.failedStep)}:`;
  return `${head}\n  ${step} ${entry.failure ?? "failed"}`.replace(/\s+$/, "");
}

export function renderSuiteReport(result: SuiteResult): string {
  const lines: string[] = [];
  if (result.scriptErrors.length > 0) {
    lines.push(CONSOLE_CHECK_FAIL);
    for (const error of result.scriptErrors) {
      lines.push(`  ${error}`);
    }
  } else {
    lines.push(CONSOLE_CHECK_PASS);
  }
  result.results.forEach((entry, index) => {
    lines.push(checkLine(entry, index + 1));
  });
  if (result.results.length === 0) {
    lines.push("1. [FAIL] the suite found no checks to run");
  }
  lines.push("");
  if (result.fatal !== undefined) {
    lines.push(`The suite could not run: ${result.fatal}`);
    lines.push("");
  }
  const inherited = result.results.filter((entry) => entry.inherited).length;
  if (inherited > 0) {
    lines.push(
      `${String(inherited)} of ${String(result.results.length)} checks are regression checks inherited from earlier features.`,
    );
    lines.push("");
  }
  for (const error of result.consoleErrors) {
    if (!result.scriptErrors.includes(error)) {
      lines.push(`  ${error}`);
    }
  }
  lines.push(`OVERALL: ${suitePassed(result) ? "PASS" : "FAIL"}`);
  return `${lines.join("\n")}\n`;
}

/** Checks that failed and belong to an already-merged feature — a broken regression. */
export function regressionFailures(result: SuiteResult): SuiteCheckResult[] {
  return result.results.filter((entry) => !entry.ok && entry.inherited);
}
