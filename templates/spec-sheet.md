# {Feature name}

## 1. Context & Goal

{1–3 sentences: what problem this solves and why it belongs in the game. The implementer has no Discord history — they need the why or they will make the wrong micro-decisions.}

## 2. Scope

### In scope

- {explicit list of what to build}

### Out of scope

- {explicit list of what NOT to touch. Stops a fresh-context agent from "helpfully" refactoring adjacent code.}

## 3. Relevant files / existing code

### Files to modify

- `{path}` — {what changes}

### Files to create

- `{path}` — {what it is}

### Existing patterns / conventions

- {e.g. follow the scene/script split used in `Player.gd`; reuse existing signal naming; match the HUD theme in `hud.tscn`}

## 4. Interface / Contract

{The concrete shape of what is being built, independent of internals: node/scene tree, GDScript class and method signatures, signals, exported properties, input actions, resource/data shapes, UI layout (sizes, colors, anchors), and animation names. This is what to build, not how. JS test hooks belong in §6, not here.}

## 5. Implementation notes / constraints

- {Non-obvious technical decisions already made}
- {Godot features, addons, or libraries to use or avoid}
- {Edge cases the planner already thought about}
- {Performance, web-export, or input constraints if relevant}

## 6. Verification hooks

Required debug bridge the implementer must expose. Do not omit this section. Do not invent a different global.

- Mechanism: Godot `JavaScriptBridge` registers `window.__egon.state`.
- Call: `window.__egon.state()` returns JSON (an object, or a JSON string the §7 expression parses).
- Fields the §7 JS expressions will read, with type and meaning:
  - `{name}` (`{number|string|boolean|…}`) — `{what it represents}`

§7 Then clauses are deterministic reads of this object. Do not ask the tester to infer pass/fail from pixels, colors, or "the screenshot looks right."

## 7. Acceptance criteria

Definition of done for the implementer (self-check before finishing) and the test plan for the tester (verified independently). Numbered list of at most 3 items. Never more than 3.

Each item is one line that names the tester's concrete steps — Keys, Click, JS, Then — not English prose. Keys are exact Playwright `browser_press_key` names (or `none`). Click is `browser_mouse_click_xy` viewport x,y in the tester's 960×540 Playwright viewport (or `none`). JS is an exact `() => …` expression the tester will `browser_evaluate`; it must read `window.__egon.state()` (the whole object or a field). Then is the expected JSON / field values. Screenshots are proof for humans, not the pass condition. Do not inspect Godot internals, duplicate the tester's implicit SCRIPT ERROR console check, or guess from pixels. Do not require capturing a single frame of a fast animation.

1. Keys: {KeyW / none}. Click: {x,y / none}. JS: {`() => window.__egon.state()`}. Then: {expected JSON}
2. Keys: {…}. Click: {…}. JS: {…}. Then: {…}
3. Keys: {…}. Click: {…}. JS: {…}. Then: {…}

## 8. Explicitly NOT this task

- {Predictable mistakes to head off, e.g. do not add new dependencies, do not retouch the main menu, do not migrate the input map. Write `None.` if there is nothing extra to call out.}
