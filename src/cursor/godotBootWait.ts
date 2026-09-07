/**
 * Deterministic Godot web boot wait for the tester.
 * Godot 4.7's HTML shell shows `#status` while wasm/pck load, then
 * `statusOverlay.remove()` when `engine.startGame()` resolves. Older shells
 * hide `#status-progress` / `#status-indeterminate` instead. A blank canvas
 * means the first frame has not drawn yet — do not guess from screenshots.
 *
 * The evaluate source must stay under Playwright's default 30s page.evaluate
 * timeout, so the inner poll is 25s. The tester may call it once more.
 */

export const GODOT_BOOT_WAIT_MS = 25_000;
export const GODOT_BOOT_POLL_MS = 100;
export const GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS = 2;

export type GodotBootSample = {
  statusInlineVisible: boolean;
  progressShown: boolean;
  indeterminateShown: boolean;
  noticeShown: boolean;
  noticeText: string;
  canvasPresent: boolean;
  canvasSized: boolean;
  pixelsDrawn: boolean;
};

export type GodotBootResult = {
  ready: boolean;
  failed: boolean;
  timedOut: boolean;
  reason: string;
  notice?: string;
};

export function imageDataLooksDrawn(data: ArrayLike<number>): boolean {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) {
      return true;
    }
  }
  return false;
}

export function interpretGodotBoot(sample: GodotBootSample): Omit<GodotBootResult, "timedOut"> {
  const notice = sample.noticeText.trim();
  if (sample.noticeShown && notice !== "") {
    return { ready: false, failed: true, reason: "status-notice", notice };
  }
  if (sample.statusInlineVisible || sample.progressShown || sample.indeterminateShown) {
    return { ready: false, failed: false, reason: "status overlay" };
  }
  if (!sample.canvasPresent) {
    return { ready: false, failed: false, reason: "no canvas" };
  }
  if (!sample.canvasSized || !sample.pixelsDrawn) {
    return { ready: false, failed: false, reason: "blank canvas" };
  }
  return { ready: true, failed: false, reason: "ready" };
}

export async function pollGodotBoot(
  sample: () => GodotBootSample,
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<GodotBootResult> {
  const timeoutMs = options?.timeoutMs ?? GODOT_BOOT_WAIT_MS;
  const pollMs = options?.pollMs ?? GODOT_BOOT_POLL_MS;
  const now = options?.now ?? Date.now;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  for (;;) {
    const state = interpretGodotBoot(sample());
    if (state.ready || state.failed) {
      return { ...state, timedOut: false };
    }
    if (now() - started >= timeoutMs) {
      return { ...state, timedOut: true };
    }
    await sleep(pollMs);
  }
}

/** Exact `browser_evaluate` function. Polls inside one call so boot does not burn criterion attempts. */
export function godotBootWaitEvaluateSource(
  timeoutMs = GODOT_BOOT_WAIT_MS,
  pollMs = GODOT_BOOT_POLL_MS,
): string {
  return `async () => {
  const timeoutMs = ${String(timeoutMs)};
  const pollMs = ${String(pollMs)};
  const started = Date.now();
  const shown = (el) => !!el && (el.style.display === "block" || el.style.display === "flex");
  const pixelsDrawn = (canvas) => {
    if (!canvas || !(canvas.width > 1) || !(canvas.height > 1)) return false;
    try {
      const w = Math.min(canvas.width, 16);
      const h = Math.min(canvas.height, 16);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      if (!ctx) return false;
      ctx.drawImage(canvas, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) return true;
      }
      return false;
    } catch {
      return false;
    }
  };
  const tick = () => {
    const status = document.getElementById("status");
    const progress = document.getElementById("status-progress");
    const indeterminate = document.getElementById("status-indeterminate");
    const notice = document.getElementById("status-notice");
    const canvas = document.getElementById("canvas") || document.querySelector("canvas");
    const noticeText = notice && typeof notice.textContent === "string" ? notice.textContent.trim() : "";
    if (shown(notice) && noticeText) {
      return { ready: false, failed: true, timedOut: false, reason: "status-notice", notice: noticeText };
    }
    const loading =
      (!!status && status.style.visibility === "visible") || shown(progress) || shown(indeterminate);
    if (loading) {
      return { ready: false, failed: false, timedOut: false, reason: "status overlay" };
    }
    if (!canvas) {
      return { ready: false, failed: false, timedOut: false, reason: "no canvas" };
    }
    if (!pixelsDrawn(canvas)) {
      return { ready: false, failed: false, timedOut: false, reason: "blank canvas" };
    }
    return { ready: true, failed: false, timedOut: false, reason: "ready" };
  };
  for (;;) {
    const state = tick();
    if (state.ready || state.failed) return state;
    if (Date.now() - started >= timeoutMs) return { ...state, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}`;
}

export const GODOT_BOOT_WAIT_EVALUATE = godotBootWaitEvaluateSource();

export function godotBootWaitPromptLines(): string[] {
  return [
    `Then call browser_evaluate with this exact function once. It polls the Godot HTML shell (#status, #status-progress, #status-indeterminate, #status-notice) and samples canvas pixels until the engine has started. Do not screenshot-loop or guess that the canvas looks ready. This wait is not a criterion attempt.`,
    GODOT_BOOT_WAIT_EVALUATE,
    `If ready is true, continue. If failed is true, the shell showed #status-notice: mark each listed criterion [FAIL] game did not boot (quote notice), still record criterion 0 from the console, OVERALL: FAIL. If timedOut is true, call the same function once more (maximum ${String(GODOT_BOOT_WAIT_MAX_EVALUATE_CALLS)} calls). If still not ready, treat as boot failure the same way. Do not spend listed-criterion attempts waiting for boot.`,
  ];
}
