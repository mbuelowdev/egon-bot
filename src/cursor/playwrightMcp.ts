import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { McpServerConfig } from "@cursor/sdk";
import { chromium, type Browser } from "playwright-core";
import { TESTER_VIEWPORT_SIZE } from "./testerCapabilities.js";

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
  "--use-gl=angle",
  "--use-angle=vulkan",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
] as const;

const HARDWARE_GPU_RENDERER = /RADV|AMD/;

export function assertHardwareGpuRenderer(info: string): void {
  if (!HARDWARE_GPU_RENDERER.test(info)) {
    throw new Error(`GPU fallback detected: ${info}`);
  }
}

export type ChromiumHandle = {
  close: () => Promise<void>;
  webglRenderer: () => Promise<string>;
};

export type LaunchChromium = (options: {
  executablePath: string;
  args: readonly string[];
}) => Promise<ChromiumHandle>;

const WEBGL_RENDERER_SOURCE = `() => {
  const gl = document.createElement("canvas").getContext("webgl");
  if (!gl) return "no-webgl";
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
}`;

async function readWebglRenderer(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    return await page.evaluate(WEBGL_RENDERER_SOURCE);
  } finally {
    await page.close();
  }
}

async function defaultLaunchChromium(options: {
  executablePath: string;
  args: readonly string[];
}): Promise<ChromiumHandle> {
  const browser = await chromium.launch({
    executablePath: options.executablePath,
    headless: true,
    args: [...options.args],
    timeout: 30_000,
  });
  return {
    close: () => browser.close(),
    webglRenderer: () => readWebglRenderer(browser),
  };
}

const chromiumLaunchChecks = new Map<string, Promise<void>>();

async function probeChromiumLaunch(
  executablePath: string,
  launch: LaunchChromium,
): Promise<void> {
  let browser: ChromiumHandle | undefined;
  try {
    browser = await launch({
      executablePath,
      args: PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS,
    });
    const info = await browser.webglRenderer();
    assertHardwareGpuRenderer(info);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith("GPU fallback detected:")) {
      throw error instanceof Error ? error : new Error(detail);
    }
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

/** Fail fast if the binary exists but cannot start, or if WebGL fell back to SwiftShader.
 * Chromium is baked into the image, so a successful probe is reused for the rest of the process. */
export async function assertPlaywrightChromiumLaunches(
  executablePath: string,
  options?: { launch?: LaunchChromium },
): Promise<void> {
  const launch = options?.launch ?? defaultLaunchChromium;
  const existing = chromiumLaunchChecks.get(executablePath);
  if (existing) {
    await existing;
    return;
  }
  const pending = probeChromiumLaunch(executablePath, launch).catch((error: unknown) => {
    chromiumLaunchChecks.delete(executablePath);
    throw error;
  });
  chromiumLaunchChecks.set(executablePath, pending);
  await pending;
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
      "--caps=vision",
      "--snapshot-mode=none",
      `--viewport-size=${TESTER_VIEWPORT_SIZE}`,
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
