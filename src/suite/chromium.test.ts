import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS,
  WEBGL_RENDERER_SOURCE,
  assertHardwareGpuRenderer,
  assertPlaywrightChromiumLaunches,
  ensurePlaywrightChromium,
  playwrightChromiumExecutable,
  type ChromiumHandle,
} from "./chromium.js";

const RADV_RENDERER =
  "ANGLE (AMD, Vulkan 1.4.318 (AMD Radeon RX 550 / 550 Series (RADV POLARIS12)...), radv)";

function fakeBrowser(overrides?: Partial<ChromiumHandle>): ChromiumHandle {
  return {
    close: async () => undefined,
    webglRenderer: async () => RADV_RENDERER,
    ...overrides,
  };
}


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


test("WEBGL_RENDERER_SOURCE runs when Playwright evaluates it as an expression", () => {
  const document = {
    createElement: () => ({ getContext: () => null }),
  };
  const result = new Function("document", `"use strict"; return ${WEBGL_RENDERER_SOURCE};`)(
    document,
  );
  assert.equal(result, "no-webgl");
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
