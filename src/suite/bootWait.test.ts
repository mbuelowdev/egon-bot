import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GODOT_BOOT_WAIT_EVALUATE,
  GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS,
  GODOT_BOOT_WAIT_MS,
  godotBootWaitEvaluateSource,
  imageDataLooksDrawn,
  interpretGodotBoot,
  pollGodotBoot,
  type GodotBootSample,
} from "./bootWait.js";

const idle: GodotBootSample = {
  statusInlineVisible: false,
  progressShown: false,
  indeterminateShown: false,
  noticeShown: false,
  noticeText: "",
  canvasPresent: true,
  canvasSized: true,
  pixelsDrawn: true,
};

test("interpretGodotBoot waits while the 4.7 status overlay is visible", () => {
  const state = interpretGodotBoot({
    ...idle,
    statusInlineVisible: true,
    pixelsDrawn: false,
  });
  assert.equal(state.ready, false);
  assert.equal(state.failed, false);
  assert.equal(state.reason, "status overlay");
});

test("interpretGodotBoot waits while older shells show progress or indeterminate", () => {
  assert.equal(
    interpretGodotBoot({ ...idle, progressShown: true, pixelsDrawn: false }).reason,
    "status overlay",
  );
  assert.equal(
    interpretGodotBoot({ ...idle, indeterminateShown: true, pixelsDrawn: false }).reason,
    "status overlay",
  );
});

test("interpretGodotBoot fails when #status-notice is shown", () => {
  const state = interpretGodotBoot({
    ...idle,
    noticeShown: true,
    noticeText: "SharedArrayBuffer is missing",
    pixelsDrawn: false,
  });
  assert.equal(state.ready, false);
  assert.equal(state.failed, true);
  assert.equal(state.reason, "status-notice");
  assert.equal(state.notice, "SharedArrayBuffer is missing");
});

test("interpretGodotBoot is ready only after overlay idle and canvas pixels", () => {
  assert.equal(interpretGodotBoot({ ...idle, pixelsDrawn: false }).reason, "blank canvas");
  assert.equal(interpretGodotBoot({ ...idle, canvasPresent: false, pixelsDrawn: false }).reason, "no canvas");
  assert.deepEqual(interpretGodotBoot(idle), { ready: true, failed: false, reason: "ready" });
});

test("imageDataLooksDrawn treats any non-zero channel as a drawn frame", () => {
  assert.equal(imageDataLooksDrawn(new Uint8ClampedArray(16)), false);
  const alpha = new Uint8ClampedArray(16);
  alpha[3] = 255;
  assert.equal(imageDataLooksDrawn(alpha), true);
  const rgb = new Uint8ClampedArray(16);
  rgb[2] = 40;
  assert.equal(imageDataLooksDrawn(rgb), true);
});

test("pollGodotBoot waits through the overlay then returns ready", async () => {
  const samples: GodotBootSample[] = [
    { ...idle, statusInlineVisible: true, pixelsDrawn: false },
    { ...idle, pixelsDrawn: false },
    idle,
  ];
  const result = await pollGodotBoot(() => samples.shift() ?? idle, {
    timeoutMs: 1000,
    pollMs: 0,
    sleep: async () => undefined,
  });
  assert.equal(result.ready, true);
  assert.equal(result.timedOut, false);
  assert.equal(samples.length, 0);
});

test("pollGodotBoot times out on a persistent blank canvas", async () => {
  let now = 0;
  const result = await pollGodotBoot(
    () => ({ ...idle, pixelsDrawn: false }),
    {
      timeoutMs: 50,
      pollMs: 10,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
  );
  assert.equal(result.ready, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.reason, "blank canvas");
});

type FakeEl = { style: { display: string; visibility: string }; textContent: string };

function installFakeGodotPage(state: {
  status?: FakeEl | null;
  progress?: FakeEl | null;
  indeterminate?: FakeEl | null;
  notice?: FakeEl | null;
  canvas?: { width: number; height: number } | null;
  pixels?: Uint8ClampedArray;
}): () => void {
  const previous = globalThis.document;
  const blank = new Uint8ClampedArray(16 * 16 * 4);
  const document = {
    getElementById(id: string) {
      if (id === "status") return state.status ?? null;
      if (id === "status-progress") return state.progress ?? null;
      if (id === "status-indeterminate") return state.indeterminate ?? null;
      if (id === "status-notice") return state.notice ?? null;
      if (id === "canvas") return state.canvas ?? null;
      return null;
    },
    querySelector(selector: string) {
      return selector === "canvas" ? (state.canvas ?? null) : null;
    },
    createElement(tag: string) {
      if (tag !== "canvas") {
        throw new Error(tag);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              return { data: state.pixels ?? blank };
            },
          };
        },
      };
    },
  };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true, writable: true });
  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", {
        value: previous,
        configurable: true,
        writable: true,
      });
    }
  };
}

test("boot-wait evaluate becomes ready after #status is removed and pixels exist", async () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  const overlay: FakeEl = { style: { display: "", visibility: "visible" }, textContent: "" };
  const progress: FakeEl = { style: { display: "block", visibility: "" }, textContent: "" };
  const canvas = { width: 640, height: 360 };
  let statusLookups = 0;
  const previous = globalThis.document;
  const document = {
    getElementById(id: string) {
      if (id === "status") {
        statusLookups += 1;
        if (statusLookups >= 2) {
          pixels[0] = 12;
          pixels[3] = 255;
          progress.style.display = "none";
          return null;
        }
        return overlay;
      }
      if (id === "status-progress") return progress;
      if (id === "canvas") return canvas;
      return null;
    },
    querySelector(selector: string) {
      return selector === "canvas" ? canvas : null;
    },
    createElement(tag: string) {
      if (tag !== "canvas") {
        throw new Error(tag);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              return { data: pixels };
            },
          };
        },
      };
    },
  };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true, writable: true });
  try {
    const wait = eval(`(${godotBootWaitEvaluateSource(200, 10)})`) as () => Promise<{
      ready: boolean;
      reason: string;
    }>;
    const result = await wait();
    assert.equal(result.ready, true);
    assert.equal(result.reason, "ready");
    assert.ok(statusLookups >= 2);
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", {
        value: previous,
        configurable: true,
        writable: true,
      });
    }
  }
});

test("boot-wait evaluate times out on a persistent blank canvas", async () => {
  const restore = installFakeGodotPage({
    canvas: { width: 640, height: 360 },
  });
  try {
    const wait = eval(`(${godotBootWaitEvaluateSource(40, 10)})`) as () => Promise<{
      ready: boolean;
      timedOut: boolean;
      reason: string;
    }>;
    const result = await wait();
    assert.equal(result.ready, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.reason, "blank canvas");
  } finally {
    restore();
  }
});

test("boot-wait evaluate fails on a visible #status-notice", async () => {
  const restore = installFakeGodotPage({
    notice: {
      style: { display: "block", visibility: "" },
      textContent: "Missing features: SharedArrayBuffer",
    },
    canvas: { width: 640, height: 360 },
  });
  try {
    const wait = eval(`(${godotBootWaitEvaluateSource(200, 10)})`) as () => Promise<{
      failed: boolean;
      notice?: string;
    }>;
    const result = await wait();
    assert.equal(result.failed, true);
    assert.match(result.notice ?? "", /SharedArrayBuffer/);
  } finally {
    restore();
  }
});

test("boot-wait evaluate source stays under Playwright's evaluate timeout", () => {
  assert.equal(GODOT_BOOT_WAIT_MS, 25_000);
  assert.ok(GODOT_BOOT_WAIT_MS < 30_000);
  assert.equal(GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS, 2);
  assert.equal(GODOT_BOOT_WAIT_EVALUATE, godotBootWaitEvaluateSource());
  assert.match(GODOT_BOOT_WAIT_EVALUATE, /getElementById\("status"\)/);
  assert.match(GODOT_BOOT_WAIT_EVALUATE, /status-notice/);
  assert.match(GODOT_BOOT_WAIT_EVALUATE, /drawImage/);
  assert.match(GODOT_BOOT_WAIT_EVALUATE, /querySelector\("canvas"\)/);
});
