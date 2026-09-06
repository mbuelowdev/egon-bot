# Milestone 2 — Working Cursor agents

Closed work order. If this conflicts with [SPEC.md](SPEC.md), SPEC wins — stop and ask.

## Goal

`/egon-plan` runs a local Cursor planner, relays questions in Discord, then runs an implementer that edits the cloned game repo. Presence shows remaining Cursor usage %. **No Godot export, serve, or tester.**

## Out of scope

- Do not start milestone 3.
- Do not install Godot, Playwright, or Chromium.
- Do not export, serve, or browser-test the game.
- Do not `git commit` or `git push` from the bot (accept path is M3).
- Do not install the Cursor IDE.

## Prerequisites

Milestone 1 Done-when checklist is complete: Discord commands, SQLite store, thread helper, Docker skeleton.

## Stack

- `@cursor/sdk` (local runtime, `Agent.create` + `send` + `wait`)
- Existing discord.js bot from M1
- Git + `gh` from env to clone/fetch `GAME_REPO_HTTPS_URL` into `GAME_REPO_DIR`

## Files to create or change

- `src/cursor/client.ts` — `Cursor.configure`, store under `$DATA_DIR/cursor-agents`, **`sendAndWait` wrapper with usage-presence `finally`**
- `src/cursor/usage.ts` — remaining included usage % for the billing period (see SPEC; do **not** use `Agent.getUsage()` for presence)
- `src/discord/presence.ts` — `client.user.setPresence` (`Watching {n}% left`)
- `src/cursor/planner.ts` — create planner, stream via wrapper
- `src/cursor/implementer.ts` — create/resume implementer
- `src/cursor/askUsersTool.ts` — `ask_discord_users` custom tool
- `src/pipeline/orchestrator.ts` — plan → (Q&A) → implement; enqueue so only one pipeline runs
- Wire `/egon-plan` to the orchestrator; keep accept/reject/pivot as stubs or no-ops until M3
- Clone/fetch game repo on boot (if not already done in M1)

## Behavior

Follow SPEC for agent roles, Q&A, presence, and implementer `deployment.json` bump **in the working tree only** (still no commit).

- Planner writes `docs/features/{slug}/SPEC.md` in the **game** repo, including numbered **Acceptance criteria**. End with `PLAN_COMPLETE` / `PLAN_BLOCKED`.
- `ask_discord_users` posts to a thread; first bot mention is the answer. On bot restart, resume the agent and `send()` the answer rather than completing a dead blocked tool call.
- After planner completes, start/resume the implementer. Persist `implementerAgentId`.
- Log `agent.agentId` and `run.id` immediately. Dispose agents. Distinguish startup errors from run errors.
- After **every** agent outcome (including throw/cancel), refresh Discord presence. Also on bot ready. Presence failures must not fail the pipeline.

## Test plan

- `/egon-plan` while another pipeline is active is rejected.
- Planner produces a game-repo SPEC with acceptance criteria; questions round-trip through a Discord thread.
- Implementer changes Godot files in `GAME_REPO_DIR` and does not push.
- Bot restart can `Agent.resume` the implementer.
- After a planner or implementer run ends in any way, presence updates (or shows `usage n/a` if the usage API fails).

## Done when

- [ ] `/egon-plan` produces a spec in the game repo
- [ ] Questions round-trip through a Discord thread
- [ ] Implementer changes Godot files; no commit/push
- [ ] Bot restart can resume the implementer
- [ ] After every agent outcome the bot presence shows remaining Cursor usage %
- [ ] No Godot export, Playwright, or Chromium yet
