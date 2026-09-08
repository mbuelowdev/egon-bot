import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import {
  ensurePlaywrightChromium,
  assertPlaywrightChromiumLaunches,
  PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS,
} from "./chromium.js";
import {
  GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS,
  godotBootWaitEvaluateSource,
  type GodotBootResult,
} from "./bootWait.js";
import { TESTER_VIEWPORT_HEIGHT, TESTER_VIEWPORT_WIDTH } from "./capabilities.js";
import { startProofVideo, stopProofVideo, waitMs } from "./record.js";
import { loadAllChecks, type SuiteCheck } from "./regression.js";
import type { SuiteCheckResult, SuiteResult } from "./report.js";
import { runCheckSteps, type StepContext, type SuitePage } from "./steps.js";
import { DEFAULT_SCENARIO } from "../features/checkSchema.js";

/**
 * The scenario suite. Deterministic, agent-free: it loads each check's scenario in a
 * fresh page, waits for the engine, confirms the scenario actually loaded, runs the
 * steps, and reports the first failure with the expression, expected, and actual.
 *
 * Every check gets its own page because the scenario is read once at startup — a clean
 * boot per check is the design, not an accident.
 */

export const MAX_CONSOLE_ERRORS = 8;

export function isScriptError(message: string): boolean {
  return message.includes("SCRIPT ERROR");
}

export function summarizeConsoleErrors(messages: string[], max = MAX_CONSOLE_ERRORS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    const line = message.replace(/\s+/g, " ").trim();
    if (line === "" || seen.has(line)) {
      continue;
    }
    seen.add(line);
    out.push(line);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

export function scenarioUrl(port: number, scenario: string): string {
  const base = `http://127.0.0.1:${String(port)}/`;
  if (scenario === DEFAULT_SCENARIO) {
    return base;
  }
  return `${base}?egon_scenario=${encodeURIComponent(scenario)}`;
}

/** One page's worth of browser surface, so the suite is testable without Chromium. */
export type SuiteSession = SuitePage & {
  goto: (url: string) => Promise<void>;
  consoleErrors: () => string[];
  close: () => Promise<void>;
};

export type OpenSuiteSession = (options: {
  screenshotsDir: string;
}) => Promise<SuiteSession>;

type BridgeProbe = { present: boolean; scenario: string | null; scenarios: string[] };

const BRIDGE_PROBE_SOURCE = `(() => {
  const bridge = window.__egon;
  if (!bridge || typeof bridge.state !== "function") {
    return { present: false, scenario: null, scenarios: [] };
  }
  const scenario = typeof bridge.scenario === "function" ? bridge.scenario() : null;
  const scenarios = typeof bridge.scenarios === "function" ? bridge.scenarios() : [];
  return { present: true, scenario: scenario ?? null, scenarios: scenarios || [] };
})()`;

async function waitForBoot(session: SuiteSession): Promise<GodotBootResult> {
  const source = `(${godotBootWaitEvaluateSource()})()`;
  let boot: GodotBootResult = {
    ready: false,
    failed: false,
    timedOut: true,
    reason: "no boot result",
  };
  for (let attempt = 0; attempt < GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS; attempt += 1) {
    boot = await session.evaluate<GodotBootResult>(source);
    if (boot.ready || boot.failed) {
      return boot;
    }
  }
  return boot;
}

function bootFailureText(boot: GodotBootResult): string {
  if (boot.notice !== undefined && boot.notice !== "") {
    return `game did not boot (${boot.reason}: ${boot.notice})`;
  }
  return `game did not boot (${boot.reason})`;
}

function screenshotNamer(checkIndex: number): (name: string, seen: number) => string {
  return (name, seen) =>
    seen === 0 ? `criterion-${String(checkIndex)}.png` : `check-${String(checkIndex)}-${name}.png`;
}

function rememberShot(screenshots: string[], fileName: string): void {
  if (!screenshots.includes(fileName)) {
    screenshots.unshift(fileName);
  }
}

/** Video proof is for the feature being built. Inherited checks stay stills so the suite does not grow a tape library. */
function wantsVideoProof(entry: SuiteCheck): boolean {
  return !entry.inherited && entry.check.proof === "video";
}

async function runOneCheck(
  entry: SuiteCheck,
  index: number,
  port: number,
  open: OpenSuiteSession,
  screenshotsDir: string,
): Promise<{ result: SuiteCheckResult; consoleErrors: string[] }> {
  const base = { name: entry.check.name, scenario: entry.check.scenario, owner: entry.owner, inherited: entry.inherited };
  let session: SuiteSession | undefined;
  try {
    session = await open({ screenshotsDir });
    await session.goto(scenarioUrl(port, entry.check.scenario));
    const boot = await waitForBoot(session);
    if (!boot.ready) {
      return {
        result: { ...base, ok: false, failure: bootFailureText(boot), screenshots: [] },
        consoleErrors: session.consoleErrors(),
      };
    }
    const probe = await session.evaluate<BridgeProbe>(BRIDGE_PROBE_SOURCE);
    if (!probe.present) {
      return {
        result: {
          ...base,
          ok: false,
          failure: "window.__egon.state is missing — the debug bridge was never registered",
          screenshots: [],
        },
        consoleErrors: session.consoleErrors(),
      };
    }
    if (probe.scenario !== entry.check.scenario) {
      const known = probe.scenarios.length > 0 ? probe.scenarios.join(", ") : "(none registered)";
      return {
        result: {
          ...base,
          ok: false,
          failure: `scenario "${entry.check.scenario}" did not load (active: ${probe.scenario ?? "null"}; registered: ${known})`,
          screenshots: [],
        },
        consoleErrors: session.consoleErrors(),
      };
    }
    const context: StepContext = {
      previous: new Map(),
      screenshots: [],
      screenshotName: screenshotNamer(index),
    };
    let recordStop: Promise<boolean> = Promise.resolve(false);
    if (wantsVideoProof(entry)) {
      const started = await session.startProofVideo();
      if (started) {
        const page = session;
        const webm = `criterion-${String(index)}.webm`;
        recordStop = page.wait(entry.check.recordMs).then(() => page.stopProofVideo(webm));
      }
    }
    const outcome = await runCheckSteps(session, entry.check, context);
    const recorded = await recordStop;
    if (wantsVideoProof(entry)) {
      const png = `criterion-${String(index)}.png`;
      try {
        await session.screenshot(png);
        rememberShot(outcome.screenshots, png);
      } catch (error) {
        console.error("proof poster screenshot failed", error);
      }
      if (recorded) {
        rememberShot(outcome.screenshots, `criterion-${String(index)}.webm`);
      }
    }
    return {
      result: { ...base, ...outcome, owner: entry.owner, inherited: entry.inherited },
      consoleErrors: session.consoleErrors(),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      result: { ...base, ok: false, failure: `the runner errored: ${detail}`, screenshots: [] },
      consoleErrors: session ? session.consoleErrors() : [],
    };
  } finally {
    if (session) {
      try {
        await session.close();
      } catch (error) {
        console.error("failed to close suite session", error);
      }
    }
  }
}

async function defaultOpenSession(options: { screenshotsDir: string }): Promise<SuiteSession> {
  const executablePath = await ensurePlaywrightChromium();
  await assertPlaywrightChromiumLaunches(executablePath);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [...PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS],
    timeout: 30_000,
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: TESTER_VIEWPORT_WIDTH, height: TESTER_VIEWPORT_HEIGHT },
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    return {
      goto: async (url) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      },
      evaluate: <T>(source: string) => page.evaluate(source) as Promise<T>,
      press: (key) => page.keyboard.press(key),
      click: (x, y) => page.mouse.click(x, y),
      move: (x, y) => page.mouse.move(x, y),
      drag: async (from, to) => {
        await page.mouse.move(from[0], from[1]);
        await page.mouse.down();
        await page.mouse.move(to[0], to[1]);
        await page.mouse.up();
      },
      screenshot: async (fileName) => {
        await page.screenshot({ path: join(options.screenshotsDir, fileName) });
      },
      startProofVideo: () => startProofVideo((source) => page.evaluate(source)),
      stopProofVideo: (fileName) =>
        stopProofVideo((source) => page.evaluate(source), join(options.screenshotsDir, fileName)),
      wait: waitMs,
      consoleErrors: () => [...errors],
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * Run every check on the branch. Never throws: an unusable browser must read as a failed
 * suite, not a crashed pipeline.
 */
export async function runScenarioSuite(options: {
  gameRepoDir: string;
  port: number;
  slug: string;
  screenshotsDir: string;
  open?: OpenSuiteSession;
}): Promise<SuiteResult> {
  const open = options.open ?? defaultOpenSession;
  rmSync(options.screenshotsDir, { recursive: true, force: true });
  mkdirSync(options.screenshotsDir, { recursive: true });

  const loaded = loadAllChecks(options.gameRepoDir, options.slug);
  if (loaded.checks.length === 0) {
    return {
      results: [],
      scriptErrors: [],
      consoleErrors: loaded.problems,
      fatal:
        loaded.problems.length > 0
          ? `no runnable checks (${loaded.problems.join("; ")})`
          : `no checks found in egon/checks for ${options.slug}`,
    };
  }

  const results: SuiteCheckResult[] = [];
  const consoleErrors: string[] = [];
  for (const [index, entry] of loaded.checks.entries()) {
    const outcome = await runOneCheck(
      entry,
      index + 1,
      options.port,
      open,
      options.screenshotsDir,
    );
    results.push(outcome.result);
    consoleErrors.push(...outcome.consoleErrors);
  }
  const summarized = summarizeConsoleErrors([...loaded.problems, ...consoleErrors]);
  return {
    results,
    scriptErrors: summarized.filter(isScriptError),
    consoleErrors: summarized,
  };
}
