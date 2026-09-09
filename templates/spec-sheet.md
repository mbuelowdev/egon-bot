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

## 4. Assets

Library assets this feature uses, named by **exact `id`** from the Asset library manifest. The implementer copies each one from the asset library into `assets/images/`, `assets/models/`, `assets/audio/`, or `assets/fonts/` (by kind) as `{id}` and imports it there. Cite those paths when the spec names a `res://` location.

- `{asset-id}` — {how this feature uses it: where it is placed, what it represents, any scaling or import setting that matters}

Name only ids that appear in the manifest. Do not invent a filename, do not guess at an asset you hope exists, and do not name an asset that has no description — undescribed assets are not in the manifest and cannot be used. The manifest's measured column is authoritative for size: if a model's bounding box means it needs scaling to fit the game, say so here.

Placeholder art the implementer draws itself (a `ColorRect`, a primitive mesh) is not a library asset and does not belong in this section — put it in §6.

Write `None.` if the feature needs no library assets.

## 5. Interface / Contract

{The concrete shape of what is being built, independent of internals: node/scene tree, GDScript class and method signatures, signals, exported properties, input actions, resource/data shapes, UI layout (sizes, colors, anchors), and animation names. This is what to build, not how. JS test hooks belong in §7, not here.}

## 6. Implementation notes / constraints

- {Non-obvious technical decisions already made}
- {Godot features, addons, or libraries to use or avoid}
- {Edge cases the planner already thought about}
- {Performance, web-export, or input constraints if relevant}

## 7. Verification hooks

Required debug bridge the implementer must expose. Do not omit this section. Do not invent a different global.

- Mechanism: the `EgonBridge` autoload, already in the project. The implementer calls `get_node("/root/EgonBridge").register_field("name", func(): return …)` once per field, normally in `_ready()`. Do not use the `EgonBridge` identifier — `--check-only` does not load autoloads. Do not ask for a hand-rolled `JavaScriptBridge` and do not reassign `window.__egon`.
- Call: `window.__egon.state()` returns a JSON object of every registered field — this feature's and every earlier feature's.
- Fields this feature registers, with type and meaning:
  - `{name}` (`{number|string|boolean|…}`) — `{what it represents}`
- Existing fields this feature reuses, from the GAME_MAP "Debug bridge" table, or `None.`:
  - `{existing field}`

Every check expression is a deterministic read of this object. Nothing infers pass/fail from pixels, colors, or "the screenshot looks right."

Prefer cumulative counters (a `jumpCount` the tap increments) over momentary flags for anything a check triggers with a key press — the runner cannot hold a key, so a field that is only true mid-press reads as zero.

## 8. Test scenarios

Which game states the checks run against. A scenario is a named routine in the game repo that puts the game into a specific state, so verification is not limited to what a cold boot can reach.

- Scenarios this feature verifies against:
  - `{scenario_name}` (existing | new) — {what state it establishes, and why this feature cannot be verified from `default`}

Use `default` — the game as it normally boots — whenever the state is reachable that way. Reuse an existing name from the GAME_MAP Scenarios table verbatim when one already establishes what you need; only declare a new one when none does. A new scenario is the implementer's job to build, as `egon/scenarios/{scenario_name}.gd` exposing `func apply() -> void:`.

The machine-executable checks go in `egon/checks/{slug}.json`, not here. Write that file too. It is a JSON array of at most 3 objects, each with `name`, `scenario`, `proof`, and `steps`. Set `proof` to `"video"` when the human needs to see motion (movement, animation, camera, particles); `"screenshot"` (the default) is enough for a static UI change. Optional `record_ms` (5000–10000, default 8000) only applies to `video`. Do not mention proof type in §9.

```json
[
  {
    "name": "{what this check proves}",
    "scenario": "{scenario_name}",
    "proof": "screenshot",
    "steps": [
      { "await": "window.__egon.state().jumpCount", "equals": "{value}" },
      { "press": "{Space}" },
      { "expect": "window.__egon.state().jumpCount", "at_least": 1 },
      { "screenshot": "{short-name}" }
    ]
  }
]
```

A step is exactly one of `press` (one Playwright key name), `click` / `move` (`[x, y]` in the 640×360 runner viewport), `drag` (`[[x1, y1], [x2, y2]]`), `await` (poll until it matches, optional `timeout_ms`), `expect` (assert once the bridge settles), or `screenshot` (a short name). `await` and `expect` take exactly one comparator: `equals`, `at_least`, `at_most`, `changed_by`, or `contains`. `changed_by` needs an earlier read of the same expression to compare against.

Waiting is always a condition. There is no sleep step. `record_ms` is only a capped clip for `proof: "video"`, never an assertion. Every expression reads `window.__egon.state()`, and every field it reads must be declared in §7. Do not write a "no SCRIPT ERROR" check — the runner always checks the console itself.

## 9. Acceptance criteria

Human-readable definition of done: a numbered list of at most 3 plain-language statements of what the feature must do. The implementer self-checks against it and humans read it on the PR. No steps, coordinates, or expressions — those live in the checks file.

1. {what must be true when this feature is done}
2. {…}
3. {…}

## 10. Explicitly NOT this task

- {Predictable mistakes to head off, e.g. do not add new dependencies, do not retouch the main menu, do not migrate the input map. Write `None.` if there is nothing extra to call out.}
