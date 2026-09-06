# Milestone 3 — Godot build, serve, Cursor testing

Closed work order. If this conflicts with [SPEC.md](SPEC.md), SPEC wins — stop and ask.

## Goal

After implement, debug-export the game to web, serve it locally, run a **new** tester agent against SPEC acceptance criteria, loop on bugs, post screenshots, then honor `/egon-accept`, `/egon-reject`, and `/egon-pivot`.

## Out of scope

- Do not start extra milestones.
- Do not add a second game repo, non-web exports, Cursor cloud runtime, or Cursor IDE.
- Do not implement PR-based git flow; push `GAME_REPO_BRANCH` (default `master`).
- Do not run two implement/test pipelines in parallel.

## Prerequisites

Milestone 2 Done-when checklist is complete: planner, Q&A, implementer resume, usage presence.

## Stack

- Godot 4.x CLI + matching web export templates (pin in Dockerfile)
- Playwright MCP + Chromium + OS deps (`npx playwright install chromium --with-deps`)
- Existing bot, Cursor SDK, git/`gh` from M1–M2

## Files to create or change

- `src/godot/export.ts` — headless `--export-debug Web` (path must end in `.html`)
- `src/godot/serve.ts` — static server + COOP/COEP, single port from `WEB_SERVE_PORT`
- `src/cursor/tester.ts` — new agent + Playwright MCP (`npx @playwright/mcp --headless --browser=chromium`); optional `publish_screenshot` custom tool writing under `$DATA_DIR/features/{id}/screenshots`
- `src/pipeline/testLoop.ts` — export → serve → test → fix (cap retries, then ping humans)
- `src/git/accept.ts` — ensure `deployment.json` version bump, commit, push `GAME_REPO_BRANCH`, cleanup
- Wire `/egon-accept`, `/egon-reject`, `/egon-pivot`
- Dockerfile: Godot + templates, Playwright OS deps, Chromium, git; `git config` from env
- Chromium flags for software WebGL (`--use-gl=angle` / SwiftShader); xvfb only if the canvas is blank

Orchestrator after implement: enter export → test loop. Tester runs still go through `sendAndWait` so presence updates.

## Behavior

Follow SPEC for Godot headers, tester contract, accept/reject, and `deployment.json`.

- Tester: new agent every cycle; open local URL; wait for canvas; execute **each** SPEC acceptance criterion in order; screenshot per criterion; `TEST_REPORT.md` with per-item PASS/FAIL. Overall PASS only if every criterion passes.
- Orchestrator posts screenshots to the feature thread.
- On FAIL: resume implementer with the report, then export/test again.
- `/egon-accept` only in `awaiting_review`. Verify/bump `deployment.json` vs origin, then commit + push.
- `/egon-reject` then `/egon-pivot` appends notes and re-enters implement (same implementer if resumable).

## Test plan

- Headless web export produces a runnable `index.html` bundle.
- Local server sends COOP/COEP; game loads in Chromium (not a black canvas).
- Tester marks each acceptance criterion; screenshots appear in Discord.
- A forced FAIL resumes the implementer and re-exports.
- `/egon-accept` bumps `deployment.json` if needed, pushes, and cleans up.
- `/egon-reject` + `/egon-pivot` does not push and re-enters implement + test.

## Done when

- [ ] After implement, a debug web build is served locally
- [ ] Tester walks SPEC acceptance criteria and posts screenshots
- [ ] FAIL loops back to implementer then export/test again
- [ ] Humans can accept (push + `deployment.json` bump + cleanup) or reject+pivot
- [ ] A jump-style feature can go idea → plan → implement → web debug build → browser test → human gate
