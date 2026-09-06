import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertPlaywrightChromiumLaunches,
  ensurePlaywrightChromium,
  playwrightChromiumExecutable,
  playwrightMcpCli,
  playwrightMcpConfigFile,
  playwrightMcpServer,
} from "./playwrightMcp.js";

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

test("assertPlaywrightChromiumLaunches closes a browser that did start", async () => {
  let closed = false;
  await assertPlaywrightChromiumLaunches("/opt/chrome", {
    launch: async () => ({
      close: async () => {
        closed = true;
      },
    }),
  });
  assert.equal(closed, true);
});
