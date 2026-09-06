import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, type SDKCustomTool } from "@cursor/sdk";
import type { Config } from "../config.js";
import type { Feature } from "../features/store.js";
import { featureSlug } from "../features/slug.js";
import { disposeAgent, localAgentOptions, sendAndWait } from "./client.js";
import {
  featurePaths,
  parseAcceptanceCriteria,
  parseTestReport,
  type TestReport,
} from "./testReport.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function testerTools(screenshotsDir: string, reportPath: string): Record<string, SDKCustomTool> {
  return {
    publish_screenshot: {
      description:
        "Save a screenshot for one acceptance criterion under the feature screenshots directory.",
      inputSchema: {
        type: "object",
        properties: {
          filename: { type: "string", description: "File name ending in .png" },
          image_base64: { type: "string", description: "PNG bytes as base64" },
        },
        required: ["filename", "image_base64"],
      },
      async execute(args) {
        const filename = asString(args.filename).replace(/[/\\]/g, "");
        if (!filename.endsWith(".png")) {
          return { content: [{ type: "text", text: "filename must end in .png" }], isError: true };
        }
        const buffer = Buffer.from(asString(args.image_base64), "base64");
        mkdirSync(screenshotsDir, { recursive: true });
        writeFileSync(join(screenshotsDir, filename), buffer);
        return `Wrote ${filename}`;
      },
    },
    write_test_report: {
      description: "Write TEST_REPORT.md marking each acceptance criterion PASS or FAIL.",
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

function testerPrompt(
  feature: Feature,
  config: Config,
  criteria: string[],
  specPath: string,
): string {
  const list =
    criteria.length > 0
      ? criteria.map((item, index) => `${String(index + 1)}. ${item}`).join("\n")
      : "(no numbered list found — inspect the SPEC and derive checks)";
  return [
    "You are the Egon tester. Use the Playwright MCP browser. Do not edit the Godot project.",
    `Open http://127.0.0.1:${String(config.webServePort)}/`,
    "Wait until the game canvas is visible and not blank.",
    `Read ${specPath} if needed.`,
    "Execute each acceptance criterion in order. Screenshot each one.",
    "Save screenshots with publish_screenshot (criterion-1.png, criterion-2.png, ...).",
    "Write TEST_REPORT.md with write_test_report. Mark each criterion [PASS] or [FAIL].",
    "Overall PASS only if every criterion passes. End the report with OVERALL: PASS or OVERALL: FAIL.",
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
  mkdirSync(paths.screenshotsDir, { recursive: true });

  const customTools = testerTools(paths.screenshotsDir, paths.reportPath);
  const base = localAgentOptions(options.config, customTools);
  const agent = await Agent.create({
    ...base,
    tools: ["read", "glob", "ls", "mcp"],
    mcpServers: {
      playwright: {
        command: "npx",
        args: [
          "@playwright/mcp",
          "--headless",
          "--browser=chromium",
          "--isolated",
          "--no-sandbox",
          "--output-dir",
          paths.screenshotsDir,
          "--config",
          join(process.cwd(), "playwright-mcp.json"),
        ],
      },
    },
  });
  try {
    const result = await sendAndWait(agent, testerPrompt(options.feature, options.config, criteria, specPath), {
      local: { customTools },
      mcpServers: {
        playwright: {
          command: "npx",
          args: [
            "@playwright/mcp",
            "--headless",
            "--browser=chromium",
            "--isolated",
            "--no-sandbox",
            "--output-dir",
            paths.screenshotsDir,
            "--config",
            join(process.cwd(), "playwright-mcp.json"),
          ],
        },
      },
    });
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
