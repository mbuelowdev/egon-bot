import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Agent, type SDKCustomTool } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { gameMapPromptSection, loadGameMapMarkdown } from "../godot/gameMap.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import { loadImplementerSummary } from "./implementerSummary.js";
import {
  assertPlaywrightChromiumLaunches,
  ensurePlaywrightChromium,
  playwrightMcpServer,
} from "./playwrightMcp.js";
import { godotBootWaitPromptLines } from "./godotBootWait.js";
import { TESTER_VIEWPORT_SIZE } from "./testerCapabilities.js";
import { testerFactsPromptSection } from "./testerFacts.js";
import {
  ensureImplicitConsoleCriterion,
  featurePaths,
  MAX_ACCEPTANCE_CRITERIA,
  parseAcceptanceCriteria,
  parseTestReport,
  type TestReport,
} from "./testReport.js";

/** Replay / wait / screenshot cycles before the tester must mark a criterion and move on. */
export const MAX_CRITERION_ATTEMPTS = 5;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function screenshotBasename(name: string): string {
  return basename(name.replace(/\\/g, "/"));
}

/** Rename a Playwright-saved PNG onto a stable criterion-N.png name. Fallback when the shot was not saved as criterion-N.png. Never accepts image bytes. */
export function publishScreenshotFromDisk(
  screenshotsDir: string,
  filename: string,
  source: string,
): { ok: true; filename: string } | { ok: false; error: string } {
  const destName = screenshotBasename(filename);
  if (!destName.endsWith(".png")) {
    return { ok: false, error: "filename must end in .png" };
  }
  const dir = resolve(screenshotsDir);
  const sourceName = screenshotBasename(source);
  if (sourceName === "" || destName === "") {
    return { ok: false, error: "source and filename are required" };
  }
  const sourcePath = resolve(dir, sourceName);
  const destPath = resolve(dir, destName);
  if (!sourcePath.startsWith(`${dir}/`) || !destPath.startsWith(`${dir}/`)) {
    return { ok: false, error: "screenshot paths must stay in the screenshots directory" };
  }
  if (!existsSync(sourcePath)) {
    return { ok: false, error: `source screenshot not found: ${sourceName}` };
  }
  mkdirSync(dir, { recursive: true });
  if (sourcePath !== destPath) {
    renameSync(sourcePath, destPath);
  }
  return { ok: true, filename: destName };
}

function testerTools(screenshotsDir: string, reportPath: string): Record<string, SDKCustomTool> {
  return {
    publish_screenshot: {
      description:
        "Fallback: rename a Playwright screenshot already on disk to criterion-N.png when the shot was not saved under that name. Pass the saved file name, not image bytes.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "Destination file name ending in .png" },
          source: {
            type: "string",
            description: "Existing screenshot file Playwright saved (basename or path)",
          },
        },
        required: ["filename", "source"],
      },
      async execute(args) {
        const result = publishScreenshotFromDisk(
          screenshotsDir,
          asString(args.filename),
          asString(args.source),
        );
        if (!result.ok) {
          return { content: [{ type: "text", text: result.error }], isError: true };
        }
        return `Wrote ${result.filename}`;
      },
    },
    write_test_report: {
      description:
        "Write TEST_REPORT.md marking implicit criterion 0 (no SCRIPT ERROR in console) [PASS] or [FAIL], then each acceptance criterion [PASS], [FAIL], or [COULD NOT VERIFY].",
      inputSchema: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "Full TEST_REPORT.md contents" },
        },
        required: ["markdown"],
      },
      async execute(args) {
        mkdirSync(join(reportPath, ".."), { recursive: true });
        writeFileSync(reportPath, asString(args.markdown), "utf8");
        return `Wrote ${reportPath}`;
      },
    },
  };
}

function implementerSummaryPromptSection(summary: string): string[] {
  const trimmed = summary.trim();
  if (trimmed === "") {
    return [];
  }
  return [
    "",
    "Implementer summary (claims, not evidence — independently execute the Keys, Click, and JS):",
    trimmed,
  ];
}

export function testerPrompt(
  feature: Feature,
  config: Config,
  criteria: string[],
  gameMap = "",
  implementerSummary = "",
): string {
  const listed =
    criteria.length > 0
      ? criteria.map((item, index) => `${String(index + 1)}. ${item}`).join("\n")
      : `(no numbered list found — at most ${String(MAX_ACCEPTANCE_CRITERIA)} listed checks)`;
  const list = `0. no SCRIPT ERROR in console (implicit; browser_console_messages level: "error")\n${listed}`;
  return [
    "You are the Egon tester. Use the Playwright MCP browser. Do not edit the Godot project.",
    `Open http://127.0.0.1:${String(config.webServePort)}/`,
    ...godotBootWaitPromptLines(),
    "Do not call browser_snapshot. Playwright is launched with --snapshot-mode=none because the page is a single canvas; an accessibility tree is waste. Use coordinate mouse tools, keys, evaluate, and screenshots.",
    "",
    'Criterion 0 is implicit and is not in the SPEC: no SCRIPT ERROR in the browser console. Godot script errors surface there in web builds — a scene that throws every frame but still renders must FAIL. After boot wait returns ready, and again after the last listed criterion, call browser_console_messages with level "error" (core Playwright MCP; no extra cap). If any returned message contains SCRIPT ERROR, mark 0. [FAIL] and quote those lines. Otherwise mark 0. [PASS] no SCRIPT ERROR in console. Other console noise without SCRIPT ERROR is not a fail. Criterion 0 is [PASS] or [FAIL] only — never [COULD NOT VERIFY]. If you cannot read the console, that is [FAIL]. Do not screenshot criterion 0. Do not invent other console-error checks.',
    "",
    `Execute each listed acceptance criterion in order (maximum ${String(MAX_ACCEPTANCE_CRITERIA)}). Screenshot each listed one as human proof.`,
    `Follow the Keys (browser_press_key), Click (browser_mouse_click_xy), and JS (browser_evaluate) named in each listed criterion. Click, move, or drag on the Godot canvas with browser_mouse_click_xy / browser_mouse_move_xy / browser_mouse_drag_xy (viewport x,y). Playwright is launched with --viewport-size=${TESTER_VIEWPORT_SIZE}; use the criterion coordinates as-is. Judge PASS/FAIL from the JS return (\`window.__egon.state()\`), not by guessing from pixels. Do not invent Godot inspector access.`,
    "If `window.__egon.state` is missing or does not return the JSON the spec named, that criterion is [FAIL].",
    `At most ${String(MAX_CRITERION_ATTEMPTS)} attempts per listed criterion. An attempt is one setup plus JS read (and screenshot). Replay, reload, or wait and try again.`,
    "If the named JS still cannot be evaluated after that, keep the last screenshot as criterion-N.png, mark that criterion [COULD NOT VERIFY], and continue. Do not loop on one criterion. Do not fall back to pixel-guessing.",
    'Take each screenshot with Playwright, passing filename "criterion-1.png", "criterion-2.png", .... A relative filename stays in --output-dir (the screenshots directory) and the image comes back inline either way.',
    "If Playwright saved a different name, publish_screenshot with source set to that saved file name and filename criterion-N.png. Never pass image bytes or base64. Never screenshot or publish criterion-0.png.",
    "Write TEST_REPORT.md with write_test_report. Mark 0. [PASS] or 0. [FAIL] first, then each listed criterion [PASS], [FAIL], or [COULD NOT VERIFY].",
    "[FAIL] only when the game is clearly wrong (including SCRIPT ERROR in the console). [COULD NOT VERIFY] when you could not complete a listed check.",
    "Treat listed [COULD NOT VERIFY] as overall PASS. Overall FAIL if criterion 0 is not [PASS] or if any listed criterion is [FAIL].",
    "End the report with OVERALL: PASS or OVERALL: FAIL.",
    "",
    ...gameMapPromptSection(gameMap),
    ...testerFactsPromptSection(gameMap),
    `Feature: ${feature.name}`,
    "Acceptance criteria:",
    list,
    ...implementerSummaryPromptSection(implementerSummary),
  ].join("\n");
}

export async function runTester(options: {
  config: Config;
  feature: Feature;
  implementerSummary?: string;
}): Promise<TestReport> {
  const slug = featureSlug(options.feature.name);
  const specPath = join(options.config.gameRepoDir, "docs", "features", slug, "SPEC.md");
  let spec = "";
  try {
    spec = readFileSync(specPath, "utf8");
  } catch {
    spec = "";
  }
  const criteria = parseAcceptanceCriteria(spec);
  const paths = featurePaths(options.config.dataDir, options.feature.id);
  rmSync(paths.screenshotsDir, { recursive: true, force: true });
  mkdirSync(paths.screenshotsDir, { recursive: true });

  const customTools = testerTools(paths.screenshotsDir, paths.reportPath);
  const executablePath = await ensurePlaywrightChromium();
  await assertPlaywrightChromiumLaunches(executablePath);
  const mcpServers = {
    playwright: playwrightMcpServer({
      screenshotsDir: paths.screenshotsDir,
      executablePath,
    }),
  };
  const base = localAgentOptions(options.config, "tester", customTools);
  const agent = await Agent.create({
    ...base,
    tools: ["read", "glob", "ls", "mcp"],
    mcpServers,
  });
  try {
    const result = await sendAndWait(
      agent,
      testerPrompt(
        options.feature,
        options.config,
        criteria,
        loadGameMapMarkdown(options.config),
        options.implementerSummary ?? loadImplementerSummary(options.config.dataDir, options.feature.id) ?? "",
      ),
      {
        local: { customTools },
        mcpServers,
      },
      { config: options.config, featureId: options.feature.id, role: "tester" },
    );
    if (result.status !== "finished") {
      writeFileSync(
        paths.reportPath,
        `OVERALL: FAIL\n1. [FAIL] Tester run ${result.status}: ${result.errorMessage ?? ""}\n`,
        "utf8",
      );
    }
  } finally {
    await disposeAgent(agent);
  }

  let raw: string;
  try {
    raw = readFileSync(paths.reportPath, "utf8");
  } catch {
    raw = "OVERALL: FAIL\n1. [FAIL] Tester did not write TEST_REPORT.md\n";
  }
  const withConsole = ensureImplicitConsoleCriterion(raw);
  if (withConsole !== raw) {
    raw = withConsole;
  }
  writeFileSync(paths.reportPath, raw, "utf8");
  return parseTestReport(raw);
}
