import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Agent, type SDKCustomTool } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import {
  assertPlaywrightChromiumLaunches,
  ensurePlaywrightChromium,
  playwrightMcpServer,
} from "./playwrightMcp.js";
import {
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

/** Rename a Playwright-saved PNG onto a stable criterion-N.png name. Never accepts image bytes. */
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
        "Rename a Playwright screenshot already on disk to criterion-N.png. Pass the saved file name, not image bytes.",
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
        "Write TEST_REPORT.md marking each acceptance criterion [PASS], [FAIL], or [COULD NOT VERIFY].",
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

export function testerPrompt(
  feature: Feature,
  config: Config,
  criteria: string[],
  specPath: string,
): string {
  const list =
    criteria.length > 0
      ? criteria.map((item, index) => `${String(index + 1)}. ${item}`).join("\n")
      : `(no numbered list found — inspect the SPEC and derive at most ${String(MAX_ACCEPTANCE_CRITERIA)} checks)`;
  return [
    "You are the Egon tester. Use the Playwright MCP browser. Do not edit the Godot project.",
    `Open http://127.0.0.1:${String(config.webServePort)}/`,
    "Wait until the game canvas is visible and not blank.",
    `Read ${specPath} if needed.`,
    `Execute each listed acceptance criterion in order (maximum ${String(MAX_ACCEPTANCE_CRITERIA)}). Screenshot each one.`,
    `At most ${String(MAX_CRITERION_ATTEMPTS)} attempts per criterion. An attempt is one setup plus screenshot (replay, reload, or wait and try again).`,
    "If it is still not verifiable after that — including a projectile or other fleeting visual — publish the last screenshot, mark that criterion [COULD NOT VERIFY], and continue. Do not loop on one criterion.",
    "Take each screenshot with Playwright. Do not pass a filename so the PNG is written into the screenshots directory and you can see it.",
    "Then publish_screenshot with source set to that saved file name and filename criterion-1.png, criterion-2.png, .... Never pass image bytes or base64.",
    "Write TEST_REPORT.md with write_test_report. Mark each criterion [PASS], [FAIL], or [COULD NOT VERIFY].",
    "[FAIL] only when the game is clearly wrong. [COULD NOT VERIFY] when you could not complete the check.",
    "Treat [COULD NOT VERIFY] as overall PASS. Overall FAIL only if any criterion is [FAIL].",
    "End the report with OVERALL: PASS or OVERALL: FAIL.",
    "",
    `Feature: ${feature.name}`,
    "Acceptance criteria:",
    list,
  ].join("\n");
}

export async function runTester(options: {
  config: Config;
  feature: Feature;
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
  const base = localAgentOptions(options.config, customTools);
  const agent = await Agent.create({
    ...base,
    tools: ["read", "glob", "ls", "mcp"],
    mcpServers,
  });
  try {
    const result = await sendAndWait(
      agent,
      testerPrompt(options.feature, options.config, criteria, specPath),
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
    writeFileSync(paths.reportPath, raw, "utf8");
  }
  return parseTestReport(raw);
}
