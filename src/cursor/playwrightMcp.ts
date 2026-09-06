import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { McpServerConfig } from "@cursor/sdk";
import { chromium, type Browser } from "playwright-core";

const execFileAsync = promisify(execFile);

export function playwrightMcpCli(): string {
  return join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
}

export function playwrightMcpConfigFile(): string {
  return join(process.cwd(), "playwright-mcp.json");
}

export function playwrightCoreCli(): string {
  return join(process.cwd(), "node_modules", "playwright-core", "cli.js");
}

export function playwrightChromiumExecutable(): string {
  return chromium.executablePath();
}

export async function defaultInstallChromium(): Promise<void> {
  await execFileAsync(
    process.execPath,
    [playwrightCoreCli(), "install", "--no-shell", "chromium"],
    { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
  );
}

export const PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--ignore-gpu-blocklist",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
] as const;

export type ChromiumHandle = {
  close: () => Promise<void>;
};

export type LaunchChromium = (options: {
  executablePath: string;
  args: readonly string[];
}) => Promise<ChromiumHandle>;

async function defaultLaunchChromium(options: {
  executablePath: string;
  args: readonly string[];
}): Promise<Browser> {
  return chromium.launch({
    executablePath: options.executablePath,
    headless: true,
    args: [...options.args],
    timeout: 30_000,
  });
}

/** Fail fast if the binary exists but cannot actually start (missing libs, sandbox, etc.). */
export async function assertPlaywrightChromiumLaunches(
  executablePath: string,
  options?: { launch?: LaunchChromium },
): Promise<void> {
  const launch = options?.launch ?? defaultLaunchChromium;
  let browser: ChromiumHandle | undefined;
  try {
    browser = await launch({
      executablePath,
      args: PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Playwright Chrome for Testing could not launch at ${executablePath}: ${detail}`,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close failures after a successful launch probe
      }
    }
  }
}

export async function ensurePlaywrightChromium(options?: {
  execInstall?: () => Promise<void>;
  isInstalled?: (path: string) => boolean;
}): Promise<string> {
  const execInstall = options?.execInstall ?? defaultInstallChromium;
  const isInstalled = options?.isInstalled ?? existsSync;
  const exe = playwrightChromiumExecutable();
  if (!isInstalled(exe)) {
    console.log(`Installing Playwright Chrome for Testing at ${exe}`);
    await execInstall();
  }
  if (!isInstalled(exe)) {
    throw new Error(
      `Playwright Chrome for Testing is missing at ${exe}. The tester cannot open the game.`,
    );
  }
  return exe;
}

export function playwrightMcpServer(options: {
  screenshotsDir: string;
  executablePath: string;
}): McpServerConfig {
  return {
    command: process.execPath,
    args: [
      playwrightMcpCli(),
      "--headless",
      "--browser=chromium",
      "--isolated",
      "--no-sandbox",
      "--output-dir",
      options.screenshotsDir,
      "--config",
      playwrightMcpConfigFile(),
      "--executable-path",
      options.executablePath,
    ],
    cwd: process.cwd(),
  };
}
