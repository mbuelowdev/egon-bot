# Milestone 4 — Game scenarios and the agent-free suite

Closed work order. If this conflicts with [SPEC.md](SPEC.md), SPEC wins — stop and ask.

## Goal

Make verification reach states a cold boot cannot. Add named, game-authored **scenarios** that load the game into a specific state; move the machine-executable checks out of the spec and into the game repo beside those scenarios; and replace the Cursor tester agent with a deterministic Playwright **scenario suite** that also re-runs every merged feature's checks as a regression pass.

## Out of scope

- Do not start extra milestones.
- Do not add an in-engine Godot test framework (GUT, GdUnit4) or any `addons/` dependency. See SPEC "Out of scope" for why.
- Do not let the harness inject game state from outside. Scenarios are game code.
- Do not add a scenario-switching path that works mid-session. The trigger is read once at startup, by design — every check gets a clean boot.
- Do not change planner backends, Discord commands, PR flow, or the catalog beyond the reporting shape below.

## Prerequisites

Milestones 1–3 complete: planner, implementer, export, serve, and the current tester loop all working.

## Stack

Existing bot, Cursor SDK, Godot CLI, Playwright + Chromium. Playwright is now driven **directly** (`playwright-core`, already a dependency via preflight) instead of through Playwright MCP. `@playwright/mcp` becomes unused once the tester agent is gone.

## Files to create or change

**Game side (orchestrator-owned templates)**

- `templates/egon_bridge.gd` — add the scenario registry beside `register_field`: `register_scenario(name, callable)`, `registered_scenarios()`, and a `window.__egon.scenarios()` bootstrap entry so the suite can assert a name exists. Read the trigger once in `_ready()`: `window.location.search` on web, `OS.get_cmdline_user_args()` headless. Gate the whole path on `OS.is_debug_build()`. An unknown name pushes an error and halts — never a silent fall-through to the normal boot.
- `src/godot/egonBridge.ts` — unchanged ownership model; export the scenarios directory constant and keep overwriting the autoload every run.

**Spec contract**

- `templates/spec-sheet.md` — insert §7 **Test scenarios** (prose scenario declarations only; the checks live in `egon/checks/{slug}.json`), renumber Acceptance criteria to §8 and Explicitly NOT this task to §9. Acceptance criteria becomes plain-language definition of done with no steps or coordinates.
- `src/features/specSections.ts` — add a `TEST_SCENARIOS_HEADING_RE` section parser. Existing parsers match on heading name, so renumbering needs no other change.
- `src/features/checkSchema.ts` *(new)* — parse and validate `egon/checks/{slug}.json`: at most 3 checks, each `{ name, scenario, steps }`; step kinds `press` / `click` / `move` / `drag` / `await` / `expect` / `screenshot`; comparators `equals` / `at_least` / `at_most` / `changed_by` / `contains`; coordinates inside 640×360; Playwright key names (reuse the existing alias table); expressions must read `window.__egon.state()`; reject any duration-based wait.
- `src/features/criterionShape.ts` — retire. Its key-alias and coordinate checks move into `checkSchema.ts`.
- `src/features/specValidate.ts` — extend the gate to cover **both** planner outputs: the spec headings and criteria, plus the checks file parsing and passing the schema, every named scenario either in the GAME_MAP Scenarios table or declared new in §7, and every bridge field an expression reads declared in §6 or already in the Debug bridge table. A `PLAN_COMPLETE` with a valid spec and a broken checks file is not complete.

**Planner outputs**

- `src/claude/permissions.ts` — `canUseTool` must allow the planner to write exactly two paths: `docs/features/{slug}/SPEC.md` and `egon/checks/{slug}.json`. Nothing else.
- `src/pipeline/runPlanner.ts` — commit both files together with the spec commit.

**Prompts**

- `src/cursor/plannerPrompt.ts` — inject the Scenarios table (compact index only, never the accumulated checks); instruct reuse-or-declare; teach the step schema. Replace the Keys/Click/JS/Then grammar.
- `src/cursor/testerCapabilities.ts` → `src/suite/capabilities.ts` — same purpose (tell the planner what the executor can do), rewritten for the deterministic runner. Drop the attempt-cap and "cannot hold a key" caveats that were about an LLM driving; keep the tap/counter rule and the Godot→viewport coordinate conversion.
- `src/cursor/implementer.ts` — add the scenario duties from SPEC: build declared scenarios, reuse existing names verbatim, verify headless with `-- --egon-scenario=`, and repair scenarios the change breaks.
- `src/cursor/godotCli.ts` — add the scenario command to the cheat sheet and extend the pre-finish loop to import → parse-check → smoke-run → **run affected scenarios** → grep.

**The suite**

- `src/suite/runner.ts` *(new)* — one Chromium process, one page per check. Per check: navigate with `?egon_scenario={name}`, run the existing boot poll, assert the scenario loaded, execute steps, collect console errors, screenshot on `screenshot` steps and on failure.
- `src/suite/steps.ts` *(new)* — the step executor. Reuse `egonStatePoll.ts`'s settle-poll for every `await` / `expect`.
- `src/suite/report.ts` *(new)* — `TEST_REPORT.md` plus a structured result: per check, the scenario, pass/fail, and on failure the step index, expression, expected, actual, and screenshot path.
- `src/suite/regression.ts` *(new)* — glob `egon/checks/*.json` on the working branch and load every check. A check whose scenario is not registered is reported as broken, never silently skipped. Nothing here reads a SPEC or touches `$DATA_DIR` — the branch is the source of truth.
- `src/cursor/godotBootWait.ts`, `src/cursor/egonStatePoll.ts` — move under `src/suite/`; keep the logic, drop the prompt-line exports.
- `src/cursor/preflight.ts` — fold into the runner as the `default` scenario check. Its job was to avoid burning a tester agent; there is no longer an agent to burn.
- `src/cursor/tester.ts`, `src/cursor/testerFacts.ts` — delete with the tester agent.
- `src/cursor/testReport.ts` — keep the report parsing the catalog and Discord consume; retarget from criteria to checks.

**Pipeline and map**

- `src/pipeline/testLoop.ts` — replace `runTester` with the suite. Keep `MAX_TEST_CYCLES`. Feed failing checks (plus screenshots as vision) to the implementer exactly as tester FAILs are fed today.
- `src/godot/gameMap.ts` — parse `register_scenario` like `parseBridgeFields` does, and emit a `## Scenarios` table.
- `src/discord/*`, `src/catalog/*` — report per **check** instead of per criterion; drop `COULD NOT VERIFY` from the vocabulary.

## Behavior

Follow SPEC "Game scenarios" and "Scenario suite (no agent)".

- Every check names a scenario; `default` means normal boot.
- The suite runs this feature's checks plus inherited ones; a regression failure names the feature that owns the broken check.
- No attempt caps, no `COULD NOT VERIFY`. A step executes and asserts, or it fails with a reason.
- Console `SCRIPT ERROR` fails the check it occurred in. The runner owns that check; specs never write it.
- Waits are conditions. No sleeps anywhere in a check.
- Retry cap stays `MAX_TEST_CYCLES`; the fix loop is not open-ended.

## Migration

There is nothing to migrate. The game repo is currently a bare skeleton — `main.tscn` holds a single empty `Node`, `project.godot` declares no autoloads, and both previously merged features were reverted (`2d7e3ed`, `607ed55`). No spec, scenario, or check exists in the tree.

So the regression set starts empty and fills from the first feature planned under this milestone. Order the work: land the autoload change and `default`, regenerate GAME_MAP so the Scenarios table exists (empty), then switch the spec template, the planner write paths, and the gate. The first feature through the new pipeline is also the first entry in the regression set.

## Test plan

- A scenario registered in a fixture project loads from `?egon_scenario=` in the browser and from `-- --egon-scenario=` headless, and both reach the same state.
- The planner is refused a write outside its two allowed paths.
- Checks survive a game revert coherently: reverting a feature removes its checks with it, leaving no check pointing at a missing scenario.
- An unknown scenario name fails at startup instead of booting normally.
- A release-exported build ignores the scenario parameter entirely.
- The schema gate rejects: a fourth check, a bad step kind, a coordinate outside the viewport, a sleep-style wait, an unknown scenario name, and an expression reading an undeclared field.
- A check whose `expect` is wrong fails with step index, expected, and actual — and the implementer fix round receives that plus the screenshot.
- A change that breaks an inherited scenario surfaces as a regression failure naming the owning feature.
- A `SCRIPT ERROR` thrown only inside a scenario fails that check.
- Full run: idea → plan (spec with §7) → implement (scenario built, verified headless) → export → suite → PASS, with screenshots in Discord and the catalog.

## Done when

- [ ] Scenarios register on the autoload and load from both the browser and headless triggers
- [ ] `default` exists, every check names a scenario, and unknown names fail loudly
- [ ] Scenarios are gated out of release builds
- [ ] GAME_MAP lists scenarios and the planner reuses names from it
- [ ] Specs carry a Test scenarios section that the schema gate validates structurally
- [ ] The implementer builds, verifies, and repairs scenarios headless before finishing
- [ ] The suite runs agent-free, screenshots itself, and reports step-level failures
- [ ] Checks live in the game repo beside the scenarios they drive, never in `$DATA_DIR`
- [ ] Merged features' checks re-run as a regression pass, loaded from disk and never injected into a prompt
- [ ] The tester agent is gone and no pipeline path creates one
- [ ] A feature whose state is unreachable from boot — an end-game screen — can go idea → plan → implement → suite → human gate
