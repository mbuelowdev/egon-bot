/**
 * Playwright MCP viewport. Planner §7 clicks live in this space.
 * 960×540 ≈ 0.9k tokens/screenshot vs Playwright's 1280×720 default ≈ 1.6k.
 */
export const TESTER_VIEWPORT_WIDTH = 960;
export const TESTER_VIEWPORT_HEIGHT = 540;
export const TESTER_VIEWPORT_SIZE = `${TESTER_VIEWPORT_WIDTH}x${TESTER_VIEWPORT_HEIGHT}`;

/**
 * What the Cursor tester can actually do. Must stay aligned with
 * `playwrightMcpServer()` (`--caps=vision`, `--snapshot-mode=none`, `--viewport-size`, no `devtools`) and `runTester`.
 * Injected into planner prompts so §7 is written for that agent, not an imagined one.
 */
export const TESTER_CAPABILITIES_PROMPT = [
  `A later Cursor tester verifies §7 in headless Chromium via Playwright MCP (\`--caps=vision\` for coordinate mouse tools; \`--snapshot-mode=none\`; \`--viewport-size=${TESTER_VIEWPORT_SIZE}\`; no devtools cap). It is not a Godot debugger. Write every criterion for this agent.`,
  "",
  "It can:",
  "- Open the local web export and browser_evaluate-poll the Godot shell `#status` overlay / canvas pixels until the engine has started (not a visual guess).",
  `- Click, move, or drag at viewport coordinates with browser_mouse_click_xy / browser_mouse_move_xy / browser_mouse_drag_xy. Playwright is launched at ${TESTER_VIEWPORT_SIZE}; §7 Click x,y must be in that space (origin top-left), not Godot's project viewport from GAME_MAP. Use this for in-canvas sprites, Control buttons, and HUD — they are pixels, not accessibility nodes.`,
  "- Press named keys with browser_press_key (Playwright names: KeyW, Space, ArrowLeft, Digit1, …). Each call is a tap (keydown+keyup), not a hold.",
  "- Evaluate a JS function on the page with browser_evaluate, of the form `() => { … }`. That sees only DOM, `window`, and values the game exposes through JavaScriptBridge — not GDScript, the scene tree, or the remote inspector.",
  '- Read browser console errors with browser_console_messages (core, level: "error"). Godot SCRIPT ERROR lines surface there in web builds. The tester always checks this as implicit criterion 0.',
  "- Screenshot the viewport for human proof. Screenshots are not the pass/fail source.",
  "",
  "It cannot:",
  "- Use accessibility snapshot refs. Playwright is launched with --snapshot-mode=none because the Godot page is a single canvas.",
  "- Read Godot game state except via `window.__egon.state()` from §6.",
  "- See Godot stdout.",
  "- Capture a single frame of a fast animation (projectiles, particles, flashes).",
  "- Infer pass/fail by guessing from pixels, colors, or \"the screenshot looks right\".",
  '- Duplicate "no SCRIPT ERROR" / "no console errors" as a §7 item. That check is implicit criterion 0; do not write it in the spec.',
  "",
  "§6 must require a JavaScriptBridge debug bridge: `window.__egon.state()` returning JSON, listing every field §7 will read.",
  "Each §7 item must name the concrete interaction, not prose:",
  "Keys: {exact browser_press_key names, or none}. Click: {browser_mouse_click_xy x,y, or none}. JS: {exact `() => …` that reads `window.__egon.state()`, whole object or a field}. Then: {expected JSON / field values}.",
  "",
  "Bad: \"When the player dashes, they move right quickly.\"",
  "Bad: \"Keys: Space. Click: none. JS: none. Then: screenshot shows the player further right.\"",
  "Good: \"Keys: Space. Click: none. JS: `() => window.__egon.state().playerX`. Then: return is at least 80 greater than before.\"",
  `Good: "Keys: none. Click: browser_mouse_click_xy ${String(TESTER_VIEWPORT_WIDTH / 2)},${String(TESTER_VIEWPORT_HEIGHT / 2)}. JS: \`() => window.__egon.state().menuOpen\`. Then: return is false."`,
].join("\n");
