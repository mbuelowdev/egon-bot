import { MAX_CHECKS } from "../features/checkSchema.js";
import {
  TESTER_VIEWPORT_HEIGHT,
  TESTER_VIEWPORT_SIZE,
  TESTER_VIEWPORT_WIDTH,
} from "./viewport.js";

export { TESTER_VIEWPORT_HEIGHT, TESTER_VIEWPORT_SIZE, TESTER_VIEWPORT_WIDTH };

/**
 * What the scenario runner can actually do. Must stay aligned with `src/suite/runner.ts`
 * and `src/suite/steps.ts`. Injected into planner prompts so the checks are written for
 * that runner, not an imagined one.
 *
 * This describes a deterministic program, not an agent. There is nothing here that can
 * improvise around a vague instruction, which is why the schema is strict.
 */
export const RUNNER_CAPABILITIES_PROMPT = [
  `A deterministic runner executes your checks in headless Chromium at ${TESTER_VIEWPORT_SIZE}. There is no agent in the loop: every step runs exactly as written or the check fails. Write for that runner.`,
  "",
  "It can:",
  `- Load any registered scenario by name (\`?egon_scenario={name}\`) and wait for the Godot engine to start, then one second more for the scene to settle, before the first step.`,
  `- Click, move, and drag at viewport coordinates. Coordinates are in the ${TESTER_VIEWPORT_SIZE} space (origin top-left), not Godot's project viewport from GAME_MAP. Use this for in-canvas sprites, Control buttons, and HUD — they are pixels, not accessibility nodes.`,
  "- Press named keys (Playwright names: KeyW, Space, ArrowLeft, Digit1, …). Each press is a tap: keydown and keyup together, never a hold.",
  "- Evaluate an expression against `window.__egon.state()` and compare it with equals / at_least / at_most / changed_by / contains.",
  "- Re-read after input with a settle-poll: it samples until the value stops changing before judging. A Then may describe a value that takes a few frames to arrive — but not one that exists for only a few frames.",
  "- Wait for a condition to become true (`await`, with an optional `timeout_ms`).",
  "- Capture a screenshot or a 5–10s video for human proof, as each check's `proof` field says (`screenshot` or `video`). Neither is the pass condition. `video` records the canvas after that settle for `record_ms` (5000–10000, default 8000) — the one allowed duration, and only for humans. The runner holds each video-proof press briefly so motion is visible; that is not a sleep step you can write. Movement, animation, camera, and particles use `video`; a static UI change uses `screenshot`. Inherited regression checks are screenshots even if they say `video`.",
  "- Read browser console errors itself. Godot SCRIPT ERROR lines fail the check they happened in.",
  "",
  "It cannot:",
  "- Read Godot state except via `window.__egon.state()`.",
  "- See Godot stdout, the scene tree, or the remote inspector.",
  "- Hold a key down across frames. A tap can be delivered and released inside one frame, so `Input.is_action_pressed` polled in `_process` may observe it zero times.",
  "- Capture a single frame of a fast animation (projectiles, particles, flashes).",
  "- Sleep. Waiting is always a condition; there is no duration step. `record_ms` is not a wait-for-assert.",
  "- Improvise. A step that does not match the schema is rejected before it ever runs.",
  "",
  "Input-driven checks must survive a tap. Assert a cumulative field the tap increments — `jumpCount`, `dashesStarted`, `shotsFired` — or a durable result the tap causes, never a field that is only true while a key is held. `_input` / `_unhandled_input` / `Input.is_action_just_pressed` see every tap; `Input.is_action_pressed` polled in `_process` may not. A check that needs a held key is untestable: drop it or restate it as a counter.",
  "",
  `Every check names a scenario. Use "default" when the state is reachable from a normal boot; name a scenario when it is not — an end-game screen, a mid-run inventory, a boss room. Reuse a scenario from the GAME_MAP Scenarios table when one already establishes the state you need; only declare a new one when none does.`,
  "",
  `Converting a Godot position into click coordinates. The canvas fills the browser window (\`canvas_resize_policy\` is Adaptive), so how GAME_MAP's \`Viewport: WxH\` lands in ${TESTER_VIEWPORT_SIZE} depends on GAME_MAP's \`Stretch:\` line:`,
  `- \`disabled\` (Godot's default): nothing is scaled. The running root viewport IS the ${TESTER_VIEWPORT_SIZE} window, and WxH from the map is only the editor design size. Write x,y directly in that space, derived from anchors and centering (a centered Control is at ${String(TESTER_VIEWPORT_WIDTH / 2)},${String(TESTER_VIEWPORT_HEIGHT / 2)}), not from editor coordinates.`,
  `- \`canvas_items\` or \`viewport\`, WxH already 16:9: uniform scale, no letterbox. x = round(godotX × ${String(TESTER_VIEWPORT_WIDTH)} / W), y = round(godotY × ${String(TESTER_VIEWPORT_HEIGHT)} / H).`,
  `- \`canvas_items\` or \`viewport\`, any other ratio (aspect \`keep\`): letterboxed. s = min(${String(TESTER_VIEWPORT_WIDTH)} / W, ${String(TESTER_VIEWPORT_HEIGHT)} / H); x = round((${String(TESTER_VIEWPORT_WIDTH)} − W × s) / 2 + godotX × s), y = round((${String(TESTER_VIEWPORT_HEIGHT)} − H × s) / 2 + godotY × s).`,
  "If you cannot place the target confidently, or it moves, do not guess a click: use keys and state reads instead. A click that lands on empty canvas reads as a broken feature.",
  "",
  "Verification hooks must require fields on the `EgonBridge` autoload via `get_node(\"/root/EgonBridge\").register_field` (`--check-only` does not define the autoload identifier), read back as `window.__egon.state()` returning JSON. List every field the checks will read.",
  "",
  `Write at most ${String(MAX_CHECKS)} checks. Do not write a "no SCRIPT ERROR" check — the runner always checks the console itself.`,
].join("\n");
