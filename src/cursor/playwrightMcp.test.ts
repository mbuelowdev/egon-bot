import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS,
  assertHardwareGpuRenderer,
  assertPlaywrightChromiumLaunches,
  ensurePlaywrightChromium,
  playwrightChromiumExecutable,
  playwrightMcpCli,
  playwrightMcpConfigFile,
  playwrightMcpServer,
  type ChromiumHandle,
} from "./playwrightMcp.js";
import { TESTER_VIEWPORT_SIZE } from "./testerCapabilities.js";

const RADV_RENDERER =
  "ANGLE (AMD, Vulkan 1.4.318 (AMD Radeon RX 550 / 550 Series (RADV POLARIS12)...), radv)";

function fakeBrowser(overrides?: Partial<ChromiumHandle>): ChromiumHandle {
  return {
    close: async () => undefined,
    webglRenderer: async () => RADV_RENDERER,
    ...overrides,
  };
}

test("playwright MCP uses the local CLI, not npx from the game cwd", () => {
  const screenshotsDir = "/data/features/1/screenshots";
  const executablePath = "/opt/ms-playwright/chromium-1243/chrome-linux/chrome";
  const server = playwrightMcpServer({ screenshotsDir, executablePath });
  assert.equal(server.command, process.execPath);
  assert.ok("args" in server && server.args);
  assert.equal(server.args[0], playwrightMcpCli());
  assert.equal(join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js"), server.args[0]);
  assert.ok(!server.args.includes("npx"));
  assert.ok(!server.args.includes("@playwright/mcp"));
  assert.ok(server.args.includes("--browser=chromium"));
  assert.ok(server.args.includes("--headless"));
  assert.ok(server.args.includes("--no-sandbox"));
  assert.ok(server.args.includes("--caps=vision"));
  assert.ok(server.args.includes("--snapshot-mode=none"));
  assert.ok(server.args.includes(`--viewport-size=${TESTER_VIEWPORT_SIZE}`));
  assert.equal(TESTER_VIEWPORT_SIZE, "960x540");
  assert.equal(server.args[server.args.indexOf("--output-dir") + 1], screenshotsDir);
  assert.equal(server.args[server.args.indexOf("--config") + 1], playwrightMcpConfigFile());
  assert.equal(server.args[server.args.indexOf("--executable-path") + 1], executablePath);
  assert.ok("cwd" in server);
  assert.equal(server.cwd, process.cwd());
});

test("ensurePlaywrightChromium skips install when the binary is already present", async () => {
  let installs = 0;
  const exe = await ensurePlaywrightChromium({
    isInstalled: () => true,
    execInstall: async () => {
      installs += 1;
    },
  });
  assert.equal(installs, 0);
  assert.equal(exe, playwrightChromiumExecutable());
});

test("ensurePlaywrightChromium installs when the binary is missing", async () => {
  let installs = 0;
  const exe = await ensurePlaywrightChromium({
    isInstalled: () => installs > 0,
    execInstall: async () => {
      installs += 1;
    },
  });
  assert.equal(installs, 1);
  assert.equal(exe, playwrightChromiumExecutable());
});

test("ensurePlaywrightChromium fails instead of sending a game bug if install does not produce a browser", async () => {
  await assert.rejects(
    () =>
      ensurePlaywrightChromium({
        isInstalled: () => false,
        execInstall: async () => undefined,
      }),
    /Playwright Chrome for Testing is missing/,
  );
});

test("assertPlaywrightChromiumLaunches fails instead of sending a tester into a dead browser", async () => {
  await assert.rejects(
    () =>
      assertPlaywrightChromiumLaunches("/missing/chrome", {
        launch: async () => {
          throw new Error("Failed to launch chrome");
        },
      }),
    /could not launch/,
  );
});

test("chromium launches with ANGLE Vulkan, not SwiftShader", () => {
  assert.deepEqual([...PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS], [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=vulkan",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
  ]);
});

test("playwright MCP config uses the same Chromium launch args", () => {
  const config = JSON.parse(readFileSync(playwrightMcpConfigFile(), "utf8")) as {
    browser: { launchOptions: { args: string[] } };
  };
  assert.deepEqual(config.browser.launchOptions.args, [...PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS]);
});

test("assertHardwareGpuRenderer accepts RADV ANGLE", () => {
  assert.doesNotThrow(() => assertHardwareGpuRenderer(RADV_RENDERER));
});

test("assertHardwareGpuRenderer rejects SwiftShader", () => {
  assert.throws(
    () => assertHardwareGpuRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))"),
    /GPU fallback detected: ANGLE \(Google, Vulkan 1\.3\.0 \(SwiftShader Device \(Subzero\)\)\)/,
  );
});

test("assertPlaywrightChromiumLaunches launches with ANGLE Vulkan args", async () => {
  let args: readonly string[] = [];
  await assertPlaywrightChromiumLaunches("/opt/chrome-args", {
    launch: async (options) => {
      args = options.args;
      return fakeBrowser();
    },
  });
  assert.deepEqual([...args], [...PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS]);
});

test("assertPlaywrightChromiumLaunches closes a browser that did start", async () => {
  let closed = false;
  await assertPlaywrightChromiumLaunches("/opt/chrome", {
    launch: async () =>
      fakeBrowser({
        close: async () => {
          closed = true;
        },
      }),
  });
  assert.equal(closed, true);
});

test("assertPlaywrightChromiumLaunches fails when WebGL is not RADV/AMD", async () => {
  let closed = false;
  await assert.rejects(
    () =>
      assertPlaywrightChromiumLaunches("/opt/chrome-swiftshader", {
        launch: async () =>
          fakeBrowser({
            close: async () => {
              closed = true;
            },
            webglRenderer: async () => "Google SwiftShader",
          }),
      }),
    /GPU fallback detected: Google SwiftShader/,
  );
  assert.equal(closed, true);
});

test("assertPlaywrightChromiumLaunches probes Chromium once per process", async () => {
  let launches = 0;
  const launch = async () => {
    launches += 1;
    return fakeBrowser();
  };
  await Promise.all([
    assertPlaywrightChromiumLaunches("/opt/chrome-once", { launch }),
    assertPlaywrightChromiumLaunches("/opt/chrome-once", { launch }),
  ]);
  await assertPlaywrightChromiumLaunches("/opt/chrome-once", { launch });
  assert.equal(launches, 1);
});
