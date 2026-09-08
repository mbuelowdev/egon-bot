/**
 * Frame-synchronised read of the SPEC §7 debug bridge for the tester.
 *
 * `EgonBridge` pushes a fresh snapshot into `window.__egon._state` once per frame
 * (templates/egon_bridge.gd `_process`), so a `browser_evaluate` fired straight
 * after browser_press_key / browser_mouse_click_xy can still observe the frame
 * before the input — and anything behind a tween, timer, or physics step
 * reliably does. A single-shot read of a stale-but-valid value looks like a
 * clean FAIL, which is the expensive kind of wrong: it sends a correct feature
 * back through a fix cycle.
 *
 * Same shape as the boot wait: one browser_evaluate that polls internally, well
 * under Playwright's default 30s evaluate timeout.
 */

export const EGON_STATE_POLL_MS = 50;
/** The read must repeat unchanged for this long before it counts as settled. */
export const EGON_STATE_SETTLE_MS = 300;
/** Hard stop. Returns the last sample rather than throwing. */
export const EGON_STATE_TIMEOUT_MS = 2_000;

/** Marks the one line the tester replaces with the criterion's own JS. */
export const EGON_STATE_READ_PLACEHOLDER = "window.__egon.state()";

export type EgonStatePollResult<T = unknown> = {
  /** Settled value, or the last sample when the poll timed out. */
  value: T;
  /** First sample, taken before any wait. */
  first: T;
  /** Whether the value moved at all during the poll. */
  changed: boolean;
  /** Whether it stopped moving, rather than running out the clock. */
  settled: boolean;
  samples: number;
  ms: number;
  /** Present when the read itself threw — a broken bridge or malformed criterion JS. */
  error?: string;
};

/**
 * Exact `browser_evaluate` function. `readBody` is the criterion's JS expression;
 * the default reads the whole bridge object so the prompt can show it verbatim.
 */
export function egonStatePollEvaluateSource(
  readBody: string = EGON_STATE_READ_PLACEHOLDER,
  options?: { settleMs?: number; timeoutMs?: number; pollMs?: number },
): string {
  const settleMs = options?.settleMs ?? EGON_STATE_SETTLE_MS;
  const timeoutMs = options?.timeoutMs ?? EGON_STATE_TIMEOUT_MS;
  const pollMs = options?.pollMs ?? EGON_STATE_POLL_MS;
  return `async () => {
  const read = () => ${readBody};
  const settleMs = ${String(settleMs)};
  const timeoutMs = ${String(timeoutMs)};
  const pollMs = ${String(pollMs)};
  const started = Date.now();
  const key = (value) => {
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  const snap = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  };
  const sample = () => {
    try { return { ok: true, value: read() }; } catch (error) { return { ok: false, error: String(error) }; }
  };
  let taken = sample();
  let samples = 1;
  if (!taken.ok) {
    return { value: null, first: null, changed: false, settled: false, samples, ms: Date.now() - started, error: taken.error };
  }
  const first = snap(taken.value);
  const firstKey = key(taken.value);
  let last = firstKey;
  let stableSince = Date.now();
  for (;;) {
    if (Date.now() - started >= timeoutMs) {
      return { value: snap(taken.value), first, changed: last !== firstKey, settled: false, samples, ms: Date.now() - started };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    taken = sample();
    samples += 1;
    if (!taken.ok) {
      return { value: null, first, changed: false, settled: false, samples, ms: Date.now() - started, error: taken.error };
    }
    const now = key(taken.value);
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= settleMs) {
      return { value: snap(taken.value), first, changed: last !== firstKey, settled: true, samples, ms: Date.now() - started };
    }
  }
}`;
}

export const EGON_STATE_POLL_EVALUATE = egonStatePollEvaluateSource();
