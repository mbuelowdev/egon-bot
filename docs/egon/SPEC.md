# Egon spec

Source of truth for the orchestrator. Milestone work orders say **how to build a slice**. This file says **what must remain true**. If a milestone conflicts with this spec, this spec wins — stop and ask.

This repo is the orchestrator (Discord bot, Cursor SDK runners, Godot export/serve, Docker image). The Godot game lives in a **separate, already-created repo** cloned at boot from `GAME_REPO_HTTPS_URL`. There is one game and one working tree.

## Product flow

Humans talk in one Discord channel, then drive the pipeline with slash commands. Merge happens on GitHub or via the **Merge the feature** Discord button; there is no accept/reject slash command.

1. Collect ideas (`/egon-new-feature`, `/egon-add`, `/egon-add-to-feature`).
2. `/egon-plan` starts the **planner** (Claude Opus 5 via the Agent SDK; Cursor only if Claude cannot start because of Anthropic usage/spend/billing limits). Independent questions go to Discord as one `ask_discord_users` call (at most **2 rounds**, **5 questions total**; each item states a default). The channel still shows them one at a time with answer buttons. The first button or modal response is the answer for that item; unanswered items take the stated default. Global answers (art style, camera, control scheme, palette) accumulate in `docs/GAME_DECISIONS.md` so later features do not re-ask them.
3. Before the planner runs, the bot checks out `origin/$GAME_REPO_BRANCH` and creates branch `egon/{slug}-{YYYYMMDDTHHMMSSZ}` (UTC, seconds; a new feature never reuses an older branch of the same slug). The planner writes `docs/features/{slug}/SPEC.md` in the game repo. After each answered Q&A round the bot updates `docs/GAME_DECISIONS.md` from global answers. On `PLAN_COMPLETE` the bot validates both planner outputs — the spec (required headings, at most 3 numbered criteria, no leftover `{placeholder}`) and `egon/checks/{slug}.json` (parses, passes the step schema, names only known or newly declared scenarios) — sending one follow-up if either fails. When the spec passes, the bot commits it (and `docs/GAME_DECISIONS.md` when it changed), pushes the branch, opens a **draft** pull request, copies the spec into `$DATA_DIR/features/{id}/SPEC.md`, and posts the PR URL in Discord.
4. The orchestrator promotes the assets SPEC §4 names from the library into `assets/library/{kind}/{id}` in the game repo. Then a local Cursor **implementer** edits the repo on that branch, imports those assets, builds the **scenarios** the spec names, and verifies them headless before finishing. The agent does not commit or push. Its last message is a structured summary (files changed, scenarios verified, criteria self-verified, deviations). After a successful run the bot commits, pushes, and **un-drafts** the PR (spec-only commits stay draft).
5. A debug **web** export is served locally and the **scenario suite** runs against it in Chromium with **no agent**: every check named by this feature's spec, plus every check inherited from already-merged features, as a regression run. Each check loads its scenario, drives machine-executable steps, asserts against the debug bridge, and captures human proof (a screenshot, or a 5–10s video when the check says `proof: "video"`). Suite PASS/FAIL does not change draft status.
6. Suite failures and Godot web-export failures go back to the implementer (the failing check with expected vs. actual and its screenshot poster, or Godot stderr). The first two cycles resume the same agent. After cycle 2, a **new** implementer is seeded with the SPEC, the failing checks, the report, and the feature-branch git diff. The bot commits and pushes each fix. Export and run the suite again until PASS or the retry cap.
7. Power users merge the PR on GitHub or click **Merge the feature** on the Discord review-ready message. `/egon-pivot` steers the implementer without converting the PR back to draft. GitHub notifies the bot via webhook so it can clean up. After the game's **Build and deploy** GitHub Action succeeds, the bot posts a Discord one-liner with the catalog-linked feature name and a live play link.

```mermaid
flowchart TD
  humans[Discord humans]
  bot[Egon bot TypeScript]
  store[SQLite feature store]
  planner[Claude Opus planner]
  impl[Cursor implementer agent]
  godot[Godot headless export]
  serve[COOP COEP static server]
  suite[Scenario suite plus Chromium]
  git[Game repo git]
  gh[gh CLI PRs]
  catalog[Feature catalog HTTP]

  humans -->|slash commands and Q&A buttons| bot
  bot --> store
  bot -->|ask_discord_users tool| humans
  bot --> planner
  planner --> git
  bot -->|draft PR then undraft| gh
  bot --> impl
  impl --> git
  impl --> godot
  godot --> serve
  godot -->|export error| impl
  bot --> suite
  suite --> serve
  suite -->|failing check| impl
  suite -->|screenshots| bot
  bot --> catalog
  gh -->|webhook merge and deploy| bot
  humans -->|merge on GitHub| gh
  humans -->|Merge the feature button| bot
  bot -->|gh pr merge| gh
```

One Docker container runs all of this. Cursor IDE is **not** installed. The planner runs via `@anthropic-ai/claude-agent-sdk`; the implementer runs via `@cursor/sdk` inside the bot Node process; the scenario suite is plain Playwright, not an agent. The GitHub CLI (`gh`) authenticates git over HTTPS, clones the game repo, and creates/un-drafts PRs. `git` still branches, commits, and pushes.

## Concurrency

Many features may collect ideas at once. **Only one feature may be in plan → implement → test at a time**, because there is a single game working tree. `/egon-plan` fails if another pipeline is active. `/egon-stop` cancels that active work. If planning never opened a PR, the feature returns to `collecting` and the lock is released. After a PR exists, the feature goes to `awaiting_review` and the lock stays until the GitHub PR is merged (or closed without merge). Uncommitted agent edits are discarded.

## Feature state machine

`collecting` → `planning` → `implementing` → `exporting` → `testing` → `fixing` (loop back to export) → `awaiting_review` → `accepted` (GitHub merge + cleanup) or `rejected` (PR closed unmerged) or `pivoting` → `implementing`

A failed debug export from `exporting` also enters `fixing` (same retry cap as a suite failure).

`/egon-pivot` is valid from `awaiting_review` and from `rejected`. GitHub merge may also move `implementing` / `exporting` / `testing` / `fixing` / `pivoting` → `accepted` if a power user merges before the suite finishes.

Open features (for `/egon-list`) are every state except `accepted`.

## Environment

Validate in `src/config.ts`. Fail fast on missing required vars. Document every key in `.env.example`. No hardcoded channel, repo, or secrets.

Required:

- `DISCORD_TOKEN`, `DISCORD_APP_ID` — bot credentials
- `DISCORD_CHANNEL_ID` — the only channel the bot listens in; ignore slash commands and Q&A buttons elsewhere
- `DISCORD_GUILD_ID` — register guild slash commands here (instant, not global)
- `CURSOR_API_KEY` — Cursor SDK (implementer and Cursor planner fallback)
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Agent SDK (Opus planner); long-lived token from `claude setup-token`
- `GAME_REPO_HTTPS_URL` — git remote of the single game repo (e.g. `https://github.com/org/game.git`)
- `GITHUB_TOKEN` — fine-grained PAT for `gh` and git HTTPS (clone, fetch, push, create draft PR, mark ready, view on boot catch-up, watch **Build and deploy**). Needs **Contents: Read and write**, **Pull requests: Read and write**, and **Actions: Read** on the game repo.
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for `POST /github/webhook`

Optional with defaults:

- `GAME_REPO_DIR` — clone destination, default `/game`
- `GAME_REPO_BRANCH` — default `master`
- `GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` — commit identity for bot commits
- `CURSOR_MODEL_IMPLEMENTER` — default `grok-4.6` (implementer and Cursor planner fallback)
- `CURSOR_MODEL_IMPLEMENTER_EFFORT` — default `high` (`none` / `low` / `medium` / `high` / `xhigh`)
- `CURSOR_MODEL_TESTER` — default `composer-2.5` (highest call volume, lowest reasoning demand)
- `CURSOR_MODEL_TESTER_EFFORT` — default `low` (checklist execution; same allowed values as implementer). Claude planner model and effort are not env: hardcoded `claude-opus-5` at `high`.
- `DATA_DIR` — default `/data` (SQLite, Cursor agent store, Claude sessions under `$DATA_DIR/claude`, screenshots, attachments, specs, and the asset library under `$DATA_DIR/assets` with its generated `ASSETS.md`)
- `WEB_SERVE_PORT` — local Godot export server (`127.0.0.1`)
- `FEATURES_HTTP_PORT` — public catalog + webhook server, default `10001` (`0.0.0.0`)
- `FEATURES_PUBLIC_URL` — public base URL for Discord catalog links and the GitHub webhook URL, default `https://egon.mbuelow.dev`
- `CURSOR_ADMIN_API_KEY` — optional; official remaining-usage % via Admin pooled-usage

On boot: `gh auth setup-git`, then if `GAME_REPO_DIR` is empty, `gh repo clone $GAME_REPO_HTTPS_URL`; otherwise `git remote set-url origin $GAME_REPO_HTTPS_URL` and fetch. The bot never pushes `GAME_REPO_BRANCH` directly. Feature work is pushed on `egon/{slug}-{YYYYMMDDTHHMMSSZ}`; humans merge that PR on GitHub or via **Merge the feature**.

Configure a GitHub repository webhook on the game repo: URL `{FEATURES_PUBLIC_URL}/github/webhook`, content type JSON, secret `GITHUB_WEBHOOK_SECRET`, events **Pull requests** and **Workflow runs**.

## Discord commands

Keep **one registry** (name + short description + handler). `/egon-help` renders that registry so the list cannot drift. Commands only work in `DISCORD_CHANNEL_ID`.

| Command | Meaning |
| --- | --- |
| `/egon-help` | List every command with its short explanation (ephemeral) |
| `/egon-new-feature name` | Create feature; becomes this channel's "latest" |
| `/egon-add text [image]` | Append note to latest feature in this channel; optional image is stored and sent to Cursor |
| `/egon-add-to-feature name text [image]` | Append to a named feature; same optional image |
| `/egon-list` | Open features (not `accepted`): name, state, note count, PR link |
| `/egon-plan [name]` | Start planner for a named feature, or this channel's latest if omitted; fail if another pipeline is active |
| `/egon-pivot text [image]` | Change request from `awaiting_review` or `rejected`; re-enter implement + test; optional image is stored and sent to Cursor |
| `/egon-retry` | Cancel a stuck planner, implementer, or suite run and continue from the current phase (or from `awaiting_review` / `rejected`) |
| `/egon-stop` | Cancel the in-flight planner, implementer, or suite run (and any Discord Q&A wait) |
| `/egon-status` | Current pipeline feature + state + last agent activity + PR link |

There is **no** `/egon-accept` or `/egon-reject`. Merge on GitHub or click **Merge the feature** on the review-ready Discord message; pivot in Discord.

`/egon-add` errors if this channel has no latest feature. `/egon-plan` without `name` uses that same latest feature and errors the same way if there is none. `/egon-new-feature` includes an **Add specifics** button (modal) for that feature; `/egon-plan` removes it. After implement + test, the review-ready message includes **Merge the feature**; the bot removes that button after a merge (Discord click or GitHub webhook).

Optional `image` on `/egon-add`, `/egon-add-to-feature`, and `/egon-pivot` must be PNG, JPEG, GIF, or WebP. The bot downloads it immediately (Discord CDN URLs expire) into `$DATA_DIR/features/{id}/attachments/` and records it in SQLite. It is **reference material** — art direction, a mockup, "make it look like this" — and never becomes a file the game ships: nothing copies it into the game repo and no agent may import it or name it in a `res://` path. Game content comes from the asset portal instead. The first planner and implementer turn attach the files as vision input (Claude: `SDKUserMessage` image blocks; Cursor: `agent.send({ text, images })`). Follow-ups stay text-only, except `/egon-pivot` with an image attaches that new file as vision on the implementer follow-up, and suite failure rounds attach failing-check screenshots as vision on the fix follow-up. Text remains required; extra images are additional `/egon-add` or `/egon-pivot` invocations. Paste the file with the `image` option — a URL in `text` is not downloaded at add time (the implementer may still fetch http(s) URLs from notes).

### Q&A buttons

The planner passes **all independent questions in one** `ask_discord_users` call (`questions: [{ question, default, choices?, topic? }]`, at most 3 choices each). `topic` is `art-style`, `camera`, `control-scheme`, or `palette` for game-wide choices. At most **2 rounds** and **5 questions total** for the plan. Discord still posts them **one by one**. Unanswered items take the question's stated `default` (including Discord timeout; remaining items in that round also take their defaults). A later call is only for follow-ups that depend on earlier answers, and only if budget remains. After the budget, write the spec with those defaults — do not `PLAN_BLOCKED` for unanswered details. After a round completes, the bot records matching answers into `docs/GAME_DECISIONS.md` on the feature branch (keyword-match if `topic` is omitted). That file is committed with the spec.

The bot posts the current question in the channel. When it offers numbered options, the message includes **1.**, **2.**, **3.** (as applicable) plus **Answer other**. Numbered buttons submit that choice immediately; **Answer other** (or **Answer** when there are no numbered options) opens a modal. **The first successful button or modal answer wins.** Persist `plannerBackend`, `plannerAgentId`, the in-flight question batch, the current `pending_question`, and the question message id so a bot restart can finish remaining Discord items sequentially, then resume **that** backend with every collected Q and A in one follow-up.

Enable Guilds intent (slash commands, buttons, and modals).

## Cursor SDK

Always pass `local: { cwd: GAME_REPO_DIR }` and `apiKey` explicitly. Implementer (and Cursor planner fallback) from `CURSOR_MODEL_IMPLEMENTER` (default `grok-4.6`) with `params: [{ id: "reasoning", value: CURSOR_MODEL_IMPLEMENTER_EFFORT }]` (default `high`). Tester from `CURSOR_MODEL_TESTER` (default `composer-2.5`) with independent `CURSOR_MODEL_TESTER_EFFORT` (default `low`). Use `Agent.create` + `send` + `wait`, not one-shot `prompt`. Log `agent.agentId` and `run.id` immediately after `send()`. Stream tool calls to docker logs. If stream events stop, docker heartbeats and `/egon-status` / the catalog show last activity; after **60 minutes** of silence cancel the run (no Discord warning). Planner silent threshold is **30 minutes** because Opus `high` thinking can stay quiet. Waiting on `ask_discord_users` is idle, not stuck. `/egon-retry` cancels a stuck run and continues the pipeline from the current phase. Distinguish `CursorAgentError` (never started) from `result.status === "error"` (ran and failed). Dispose with `await using` / `close()`. Persist local Cursor agent state under `$DATA_DIR/cursor-agents`. Claude planner sessions persist under `$DATA_DIR/claude`.

Do **not** install the Cursor IDE. The SDK local executor runs in-process.

### Planner

Primary planner is `@anthropic-ai/claude-agent-sdk` with hardcoded `model: "claude-opus-5"` and `effort: "high"` (native 1M context; no `PLANNER_MODEL` env). Thinking is `{ type: "adaptive", display: "summarized" }`. Tools: Read, Glob, Grep, Write, Edit, plus MCP `mcp__egon__ask_discord_users`. No Bash, Agent, or WebSearch. `canUseTool` allows Write/Edit only for `docs/features/{slug}/SPEC.md`. Persist `plannerBackend: "claude" | "cursor"` next to `plannerAgentId` so resume never feeds a Cursor id into `query({ resume })` or a Claude session id into `Agent.resume`.

On a **new** plan, try Claude first. Persist `plannerBackend = "claude"` only after the Claude session actually starts. Fall back to the Cursor planner only when Claude **does not start this query** because of Anthropic usage/spend/billing limits (402 `billing_error`, spend-cap 429, specified usage-limit 400). Do **not** fall back on 401/auth, 529 overloaded, transient 429 with `retry-after`, network, `PLAN_BLOCKED`, cancel, or a Claude run that already produced work. If a later `/egon-retry` cannot start that Claude session because of usage limits, start a **fresh** Cursor planner with the full prompt plus any Discord answers already collected. On fallback, post in Discord that Claude hit a usage limit and Cursor is taking over.

The Cursor planner remains the fallback (`customTools.ask_discord_users`, same `questions[]` schema). The implementer stays on Cursor either way. There is no tester agent — verification is the agent-free scenario suite.

Writes `docs/features/{slug}/SPEC.md` **in the game repo** on branch `egon/{slug}-{YYYYMMDDTHHMMSSZ}`. Discord images collected with `/egon-add` are attached as vision on the first turn as reference material only; they are not in the working tree.

The planner system / instruction block includes the spec sheet template (`templates/spec-sheet.md`). The written spec **must** keep those headings in order: Context & Goal, Scope (in / out), Relevant files / existing code, Assets, Interface / Contract, Implementation notes / constraints, Verification hooks, Test scenarios, Acceptance criteria, Explicitly NOT this task. Fill every required section; do not leave placeholders.

Section parsers match on heading **name**, with the number prefix optional. Renumbering sections is safe; renaming one is not. Prompts and tests must refer to sections by name for the same reason — a section number baked into a prompt goes stale the moment a section is inserted.

On `PLAN_COMPLETE` the bot **validates the file in code** before accepting it (existence is not enough): required template headings present and in order, a numbered acceptance-criteria list of at most **3** items, a Test scenarios section naming at least one scenario, a checks file that parses and passes the step schema, every scenario it names either listed in the `GAME_MAP.md` Scenarios table or declared new in the spec, every bridge field its expressions read declared in Verification hooks or already in the Debug bridge table, every asset id the Assets section names present in the library with a description, and no leftover `{placeholder}` from the template. If that check fails, the same planner gets **one** targeted follow-up listing the problems. If the spec is still invalid, treat it as not complete — do not commit, copy, or open a PR.

The schema gate is the only thing standing between a malformed check and a runner that has no agent to improvise around it. Validate structurally — step kinds, comparator names, coordinate ranges, key names, scenario existence — not just that the block is valid JSON.

The first planner turn also includes `$DATA_DIR/GAME_MAP.md` when it exists (a deterministic index of the last merged Godot tree). Prefer that map over exploratory Glob/Grep/Read. If the file is missing (no merge yet), the orchestrator generates one from the current checkout.

The first planner turn also injects a compact **asset library index** — every described asset's `id` grouped by kind with its one-line description, and no measured column. It must be in the prompt rather than behind a pointer: a planner with no idea the library has a garbage truck has no reason to go looking for one, and "this feature needs no assets" is a conclusion it can only reach after seeing what exists. The spec's **Assets** section names the ids this feature uses; the gate rejects an id the library does not have, and `None.` is a valid answer.

The first planner turn also includes `docs/GAME_DECISIONS.md` from the current checkout when it exists (accumulated art style, camera, control scheme, palette). Treat filled headings as settled — do not re-ask Discord unless this feature must change one. If a heading is missing and this feature depends on it, ask and set `topic`. Questions drop toward zero as the game matures. The orchestrator writes this file from answered Q&A; `canUseTool` still allows Write/Edit only for the spec.

The Claude system prompt is constant (no feature slug) and holds the spec-sheet template plus planner rules so they prompt-cache. First-turn user messages are static-first: `GAME_MAP.md`, then `GAME_DECISIONS.md`, then feature name, spec path, and notes — so the remaining shared prefix can prompt-cache across features. Cursor planner and implementer prompts follow the same order (instruction block with template and/or Godot CLI cheat sheet, then game map, then per-feature text). Planner prompts also include game decisions after the game map.

**Verification hooks** is required. The spec must name the debug-bridge fields the implementer registers on the orchestrator-owned autoload with `get_node("/root/EgonBridge").register_field` (`--check-only` does not define the `EgonBridge` identifier), read back as `window.__egon.state()` returning JSON. List every field the Test scenarios section reads. Reuse a field already in the `GAME_MAP.md` Debug bridge table instead of registering a near-duplicate under a new name.

**Test scenarios** is required. In the spec it is prose for humans: the **scenarios** this feature needs, each either an existing name from the `GAME_MAP.md` Scenarios table (reused verbatim) or a new name the implementer must create, with one line saying what state it establishes and why this feature cannot be verified from `default`.

The machine-executable **checks** do not live in the spec. The planner writes them to `egon/checks/{slug}.json` in the game repo: an array of at most **3** objects, each `{ name, scenario, proof, steps }`. `proof` is `"screenshot"` (default) or `"video"`. Movement, animation, camera, and particles use `video`; a static UI change uses `screenshot`. Optional `record_ms` (5000–10000, default 8000) only applies to `video`. Proof type lives on the check, not in Acceptance criteria. `canUseTool` allows the planner to write exactly two paths — `docs/features/{slug}/SPEC.md` and that checks file — and nothing else. Both are committed together and validated together.

A step is exactly one of: `press` (one Playwright key name; every press is a tap, never a hold), `click` / `move` (viewport `[x, y]` in the runner's 640×360 space), `drag` (`[[x1, y1], [x2, y2]]`), `await` (poll an expression until it matches, with an optional `timeout_ms`), `expect` (assert an expression once the bridge has settled), or `screenshot` (a name; human proof, never the pass condition). `await` and `expect` take one comparator: `equals`, `at_least`, `at_most`, `changed_by`, or `contains`. Expressions read `window.__egon.state()` — the whole object or one field — and nothing else.

`egon/checks/{slug}.json`:

```json
[
  {
    "name": "victory screen shows the final score",
    "scenario": "endgame_victory",
    "proof": "screenshot",
    "steps": [
      { "await": "window.__egon.state().screen", "equals": "victory" },
      { "press": "Space" },
      { "expect": "window.__egon.state().score", "equals": 4200 },
      { "screenshot": "victory-score" }
    ]
  }
]
```

**No sleeps.** Waiting is always a condition (`await`), never a duration; `timeout_ms` bounds a wait, it does not schedule one. A suite built on frame timing is a flaky suite. `record_ms` is the exception: a capped clip for `proof: "video"`, never an assertion. Every check names a scenario — a check that runs from a cold boot names `default`. Do not write a "no SCRIPT ERROR" check: the runner always checks the console itself. Do not require capturing a single frame of a fast animation, and do not assert a field that is only true while a key is held — a tap can be delivered and released inside one frame, so assert a counter it increments or a durable result it causes.

**Acceptance criteria** is the human-readable definition of done: a numbered list of at most **3** plain-language statements of what the feature must do. The implementer self-checks against it; humans read it on the PR and the catalog. It is **not** the test plan and carries no steps, coordinates, or expressions — those live in the checks file. The planner must make the spec as specific as possible and ask Discord questions until material details are precise and certain — at most 2 rounds, 5 questions total; if a detail stays unanswered use the stated default. Do not `PLAN_BLOCKED` for unanswered details. Do not re-ask filled `GAME_DECISIONS` headings. Pass every independent unknown in **one** `ask_discord_users` call. Planner may read existing game code; it must not write outside its two allowed paths.

The first planner turn injects the runner's capability list and the `GAME_MAP.md` Scenarios and Debug bridge tables, so checks are written for the actual runner and reuse names that already exist. The tables are a compact index — name, file, one line each — not the checks themselves. **No prompt ever carries the accumulated check set.** The runner reads it from disk; only failing checks are ever sent to an agent.

End with a one-line `PLAN_COMPLETE` or `PLAN_BLOCKED` marker the orchestrator can parse. Do not commit or push; the orchestrator commits the spec after `PLAN_COMPLETE` **and** the schema check passes.

### Implementer

Separate agent from the planner. Resume it for the first fix rounds and for pivots (`implementerAgentId` on the feature). After two test cycles (`MAX_TEST_CYCLES` is 3), the next fix creates a **new** implementer instead of `Agent.resume`: first `send` is the full implementer prompt plus the SPEC text, the Test scenarios section, the suite/export report, and `git diff origin/$GAME_REPO_BRANCH...HEAD` (truncated). Persist the new `implementerAgentId`. Implement the game-repo SPEC only: honor Scope, Out of scope, Implementation notes, Verification hooks, and Explicitly NOT this task, expose `window.__egon.state()` as specified, build the scenarios §7 declares, and self-check Acceptance criteria by running those scenarios headless and reading the bridge snapshot before finishing. Modify only the files listed in SPEC §3 plus files the implementer creates; anything else must be justified under **Deviations** in the structured final message. Download asset URLs from feature notes into the Godot project. The assets SPEC §4 declared are already promoted into `assets/library/{kind}/{id}`; import them from there, and reference no other library asset, because nothing else was copied in. The implementer's first `send` carries the measured facts for exactly those ids — bounding box for scaling, grid for `AtlasTexture` / `SpriteFrames` — and never the whole library. Discord images are attached as vision on the first `send` as reference material only: they are not in the working tree and must not be imported, copied, or referenced by a `res://` path. A `/egon-pivot` image is attached as vision on that follow-up `send` on the same terms. Suite failure rounds attach the failing checks' screenshots as vision on the fix follow-up — the PNGs are the evidence, not just the report prose. Work on the feature branch already checked out.

Do **not** commit or push; the orchestrator commits after the agent finishes. Do not edit `deployment.json` — `ensureDeploymentBump` on every implementer push guarantees the version bump.

The first implementer `send` includes a short Godot CLI cheat sheet (`GODOT_CLI_GUIDE`, ~15 lines: import, parse-check changed `.gd`, smoke-run, grep — no all-scripts `xargs`, no `--verbose`, no export), a pre-compiled Godot 4 web gotcha list (`src/cursor/godotWebGotchas.ts`; never loaded from disk), and the same `GAME_MAP.md` as the planner, static-first (cheat sheet, then gotchas, then game map, then feature name/notes). The full `docs/godot-cli.md` is copied into the game repo for on-demand Read. Each gotcha is a repeat failure class: `thread_support=true` means SharedArrayBuffer/COOP-COEP; guard `JavaScriptBridge` with `OS.has_feature("web")`; `--check-only` does not load autoloads, so call the bridge with `get_node("/root/EgonBridge")` not the `EgonBridge` identifier; never hand-edit `.uid` files; `class_name` must be globally unique; no addons; do not touch `export_presets.cfg` (`ensureWebExportPreset` owns it); keep `window/size/viewport_*` at 640×360 matching Chromium. The first send also injects the SPEC's parsed acceptance-criteria list (`parseAcceptanceCriteria`, at most 3 items) so the implementer can self-check without opening the SPEC just to find them. Before finishing, the implementer must `--import`, parse-check changed `.gd` files (`--script … --check-only`), smoke-run with `--quit-after` / `--scene`, and grep the log with `rg -n --max-count 20`. Never `cat` a Godot log — a `--verbose` log is tens of thousands of lines and will blow the context window. Do not Web-export; `runExportTestLoop` debug-exports after the agent finishes. Always `--headless --path .`. Never `--test`, `--editor` / `-e`, or `--debug` unattended. Logs go under `/tmp`.

**Scenarios are the implementer's job.** Build every scenario the spec's Test scenarios section declares new, registering it on the orchestrator-owned autoload. Reuse an existing scenario exactly as named; never fork it under a new spelling. Before finishing, run each scenario this feature touches headless with `-- --egon-scenario={name}`, read the bridge snapshot, and confirm it establishes the state the spec describes. This costs no export, no server, and no browser.

**Keep the existing scenarios green.** Scenarios are code that normal play never exercises, so they rot silently. When a change touches state a registered scenario depends on, repair that scenario in the same run. This is enforced, not requested: the pre-finish loop is import → parse-check changed `.gd` → smoke-run → **run every affected scenario headless** → grep the log. A scenario that no longer starts is a failure the implementer must fix before finishing. That gate catches a scenario that errors; it cannot catch one that still runs but now builds a subtly meaningless state, which is the same limit any test suite has.

The implementer's last message is structured: **Files changed**, **Scenarios verified**, **Criteria self-verified**, **Deviations**. Follow-up sends (fixes, pivots, resume) remind the agent to end the same way. On a finished run the orchestrator writes `$DATA_DIR/features/{id}/IMPLEMENT_SUMMARY.md` for the catalog and for later fix rounds. Nothing treats it as evidence — the suite is the only source of pass/fail. Do not post that summary to Discord.

### Scenario suite (no agent)

Verification is a deterministic runner, not an LLM. After the implementer finishes and the debug export is served, the orchestrator drives Chromium directly through Playwright and executes every check it finds in `egon/checks/*.json` on the working branch: this feature's, plus every check inherited from already-merged features. That second half is the regression suite, and it is the reason scenarios persist and names stay stable.

The runner reads those files off disk. The check set grows with the game and never enters a prompt or a context window — the only checks an agent ever sees are the ones that failed. A check whose scenario no longer exists is reported as a broken check, not silently skipped.

Before the suite runs, confirm Playwright Chrome for Testing exists **and actually launches**, and assert the WebGL renderer matches `/RADV|AMD/` so a SwiftShader fallback fails loudly instead of quietly rendering a different game. Viewport is `640x360`, matching Godot `window/size/viewport_*` and the coordinate space §7 writes clicks in (the Godot page is a single canvas, so no accessibility tree is ever taken).

Per check: open `http://127.0.0.1:{WEB_SERVE_PORT}/?egon_scenario={name}`, poll the Godot HTML shell (`#status` / `#status-progress` / `#status-notice`) and canvas pixels until the engine has started, confirm the named scenario actually loaded, wait one second for shaders and the first physics ticks, then execute the steps in order. A `#status-notice` or a still-blank canvas is a boot failure for that check. Every step is deterministic; there is nothing to improvise, so there are no per-criterion attempt caps and no `COULD NOT VERIFY` — a step either executes and asserts, or it fails with a reason.

Reads go through a **settle-poll**, not a bare one-shot: the bridge pushes a snapshot once per frame, so a read fired straight after an input can still observe the frame before it, and anything behind a tween, timer, or physics step needs several more. Poll until the value holds still, then judge.

The console check is implicit and belongs to the runner, never to a spec: after each check, collect console errors and fail that check on any `SCRIPT ERROR`. A game that throws every frame but still renders must fail. Other console noise is not a failure.

The runner captures human proof itself under `$DATA_DIR/features/{id}/screenshots/`. A `screenshot` step writes a PNG. A current-feature check with `proof: "video"` records the canvas after that settle for `record_ms`, holds each press briefly so motion is visible, writes `criterion-N.webm`, and takes a last-frame PNG poster for implementer vision. Inherited regression checks stay stills. No agent is involved in producing human proof. Discord prefers the video when it is under 8 MB; the catalog Proof gallery plays it. Fix rounds still attach only the PNG.

A failing check reports the **check name, scenario, failing step index, the expression, expected vs. actual, and the screenshot at the point of failure**. That is strictly better evidence than agent prose, and it is what the orchestrator sends to the implementer as the fix round. Retry cap is the existing `MAX_TEST_CYCLES`; the loop is not open-ended.

Suite PASS requires every check to pass. Discord posts the per-check breakdown and the catalog proof gallery attaches this feature's stills or clips. A regression failure in an inherited check is reported as such, naming the feature that owns it — a change broke someone else's scenario, and the implementer needs to know that is what happened.

Only the runner needs a browser. Planner and implementer do not. Chromium lives in the same container.

Local SDK agents have no built-in browser, GUI, or `listArtifacts`. Screenshots are files the bot uploads to Discord and serves on the catalog. They are **not** deleted after merge.

### Presence = remaining Cursor usage

Every Cursor agent run goes through one wrapper (`sendAndWait`). Claude planner runs go through `queryPlanner`. A `finally` block runs whether the run finished, errored, cancelled, or threw — planner, implementer, and bug-fix follow-ups. Log Anthropic `total_cost_usd` from the Claude result message for planner runs. Presence stays Cursor remaining usage (implementer). The scenario suite is not an agent and consumes no Cursor usage.

Discord activity: `Watching 73% left` (integer percent remaining). On fetch failure: `Watching usage n/a`. Also refresh once on bot ready.

**Do not use `Agent.getUsage()` for this.** That API is billed tokens/cost for *one agent*, not remaining plan quota. Cursor plans are a monthly included usage pool (spend). Remaining % = `remaining / limit` for the current billing period.

Fetch order:

1. If `CURSOR_ADMIN_API_KEY` is set, official Admin `POST /organizations/pooled-usage` (`remainingCents` / `limitCents`).
2. Else `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` with `CURSOR_API_KEY` and parse `planUsage` (cents used vs included).
3. If both fail, log and set `usage n/a`. Never fail the pipeline because presence failed.

Usage fetch must not throw into the orchestrator. Single-flight if two agents end at once.

## Game scenarios

A **scenario** is a named routine in the game repo that puts the game into a specific state. Scenarios exist because verification cannot be limited to what is reachable from a cold boot: an end-game screen, a mid-run inventory, or a boss room is entered directly instead of played to.

Scenarios are **game-authored**. The harness never injects state from outside. A scenario calls the game's own setters and scene changes, so a refactor that breaks it breaks it loudly at startup instead of producing a plausible-but-wrong state. Registration mirrors debug-bridge fields: additive, one call per scenario, on the same orchestrator-owned autoload, which the orchestrator overwrites every run so the game cannot fork it.

Everything the suite needs lives in the **game repo**, never in the bot's `$DATA_DIR`:

```
egon/
  egon_bridge.gd        orchestrator-owned autoload (scenario registry + debug bridge)
  scenarios/*.gd        game-authored scenarios, persist across features
  checks/{slug}.json    machine-executable checks, one file per feature
```

Scenarios are game code and checks name bridge fields and viewport coordinates, so both break when the game changes. Versioning them beside the code they test is what keeps them honest: a revert takes its checks with it, a branch checkout matches checks to code, and there is no second source of truth to synchronise. Checks in the bot's data directory would survive a game revert and then assert against scenarios that no longer exist.

Two front doors into one code path, both read once at startup:

- **Browser** — `?egon_scenario={name}` on the served export, read from `window.location.search`. The static server already ignores the query string when resolving files.
- **Headless** — `-- --egon-scenario={name}`, read from the user command-line args. This is what lets the implementer verify a scenario with no export, no server, and no browser.

Invariants:

- `default` is reserved and means "the game as it normally boots." **Every check names a scenario**; a cold-boot check names `default`. There is no unnamed path and no special case.
- Scenarios live in their own directory in the game repo and **persist across features**. A scenario is never scoped to, or deleted with, the feature that introduced it — the regression suite depends on old scenarios still existing.
- Names are stable and reused. `GAME_MAP.md` carries a **Scenarios** table (name, file, what it establishes) beside the Debug bridge table, generated deterministically from the merged tree with no LLM. The planner reuses a listed name rather than minting a near-duplicate; that table is what stops the set from rotting into `endgame_win`, `end_game_victory`, and `victory_screen`.
- Scenarios must not run in a release build. Gate on `OS.is_debug_build()`; the orchestrator only ever `--export-debug`s. Without the gate, anyone can jump straight to an ending on the public URL.
- An unknown scenario name is a **hard failure at startup**, never a silent fall-through to the normal boot. A silent fall-through turns a typo into a check that passes against the wrong state.

Testing a scenario verifies the state, not the path that normally reaches it. That is the deliberate trade: a synthesized end-game screen can pass while the real game cannot reach it. Where a feature *is* reachable from boot, the planner should still write that check against `default`.

## Asset library

Every asset has an identity the agents can read. Humans upload and **describe** assets through a web portal; the bot measures format and proportions **programmatically**; agents read a generated manifest and copy into the game repo only the assets a feature actually uses.

Nothing in this path is an LLM. The human writes the description because a human knows the intent ("boss vehicle for level 3", "must tile with `grass-plain`"), which is what drives placement decisions; a vision model would only produce an appearance caption, at cost, on every run. Every fact in a sidecar is either measured by the bot or typed by a human.

The library lives in `$DATA_DIR`, outside the game repo, so unused assets never bloat git and `godot --import` only ever sees what a feature promoted:

```
$DATA_DIR/assets/
  garbage-truck-orange.glb
  garbage-truck-orange.glb.json      # meta sidecar, one per asset
  grass-plain.png
  grass-plain.png.json
  .thumbs/
    garbage-truck-orange.glb.png     # square gallery preview, models only
  .parts/
    garbage-truck.gltf/              # companion files, not assets of their own
      truck.bin
```

One sidecar per asset, not one index file: no write contention between the portal and a concurrent agent run, and deleting the pair is a complete delete. A sidecar carries `id`, `originalFilename`, `sha256`, `bytes`, `kind`, `format`, `fileOutput`, `measured`, `description`, `tags`, `grid`, optional `cellGroups`, `parts`, and `uploadedAt`. `measured` is best-effort and shaped per kind — images carry `width` / `height` / `colorType`, models carry `bboxMeters` / `triangles` / `meshes` / `materials` / `animations`, audio carries `durationSeconds` / `sampleRate` / `channels`, and a sheet's typed cell size derives `columns` / `rows` / `frames`. A reader that fails records nothing and does **not** block the upload: the description is the required part, the measurements are the bonus.

Invariants:

- **The stored filename is the asset `id`**, derived from the description at first save (slugified, extension preserved, `-2` on collision). Editing a description never renames it — a promoted `res://` path must not break. A human can rename it from the portal's filename box; that is a deliberate exception, and a spec that still names the old id fails the gate. `originalFilename` keeps the cryptic name the human dropped.
- **An asset without a description is invisible to every agent.** It is not in `ASSETS.md`, no spec may name it, and the gallery shows it as broken with an undescribed count above it. That consequence is what makes the description rule real.
- **Re-uploading identical bytes** under a different name resolves to the existing asset rather than creating a duplicate. Dropping a new file on an existing asset **replaces its bytes** and re-measures, keeping the id, description, tags, grid, and labeled sprite groups; the extension has to match. Groups whose cells no longer fit the new sheet are dropped.
- **Companion files** (a `.gltf`'s `.bin` and textures, an `.obj`'s `.mtl`, an extra animation clip) attach to an asset. They are not assets: no description, not in the manifest, and no spec can name one. Promotion copies them into the same directory as the parent so relative paths still resolve.
- **Detection is programmatic.** `file(1)` identifies the format and, for images, the proportions. Models get a real reader — GLB is a 12-byte header plus a JSON chunk, `.gltf` is that JSON, OBJ is text — because the bounding box decides whether the implementer has to scale the model and no human types it accurately.
- **Accepted, by kind:** image `.png` `.jpg` `.jpeg` `.webp` `.gif`; model `.glb` `.gltf` `.obj`; audio `.ogg` `.wav` `.mp3`; font `.ttf` `.otf` `.woff2`. Everything else is rejected **server-side**, on the file's contents rather than its extension, with a reason that says what to do instead: `.fbx` needs FBX2glTF, `.blend` needs Blender, `.psd` / `.ai` / `.xcf` are layered sources, `.aseprite` needs the Aseprite CLI, archives are not indexable, and Godot project files belong in the game repo. Renaming the extension does not get a format past the gate.
- **Promotion on use.** The orchestrator copies each asset SPEC §4 names from `$DATA_DIR/assets/{id}` to `assets/library/{kind}/{id}` in the game repo before the implementer edits, plus that asset's companion files into the same directory, and the implementer imports it there. Idempotent by sha256: a file already present with matching content is skipped. Assets are committed with the implementer's commit like any other change, and nothing else in the library reaches the repo.
- **Deleting an asset** removes it from the library, its companions, and the manifest. It does **not** touch a copy already promoted into the game repo — that is committed history and git owns it.

`$DATA_DIR/ASSETS.md` is generated from the sidecars, regenerated on every portal write and at pipeline start, and never throws: a stale manifest beats a failed run. Only described assets appear. The two agents get different slices of it — the planner a compact index of the whole library, the implementer only its spec's declared assets with their measured facts — the same split scenarios get, for the same reason: a prompt never carries accumulated detail.

Sprite sheets are containers, not assets. A sheet carries a grid spec the human types — cell width, cell height — from which columns, rows, and frame count derive programmatically, which is exactly what Godot's `AtlasTexture` / `SpriteFrames` want. Optional named cell groups (`cellGroups`) label one or more cells together ("flower variants"); those reach the planner and the implementer as region lists. Per-row labels in the description as prose still work. Irregular atlases, 9-slice edges, and autotile blobs stay approximate: grid spec plus prose (and groups where the picker fits), and the implementer works out the bitmask.

## Godot web loop

Web export only (browser game). Pin Godot 4.x plus matching **web export templates** in the Dockerfile.

Debug export:

```
godot --headless --path "$GAME_REPO_DIR" --export-debug "Web" /tmp/egon-web/index.html
```

The export path **must** end in `.html`. If `--export-debug` fails, `runExportTestLoop` sends Godot's stderr to the implementer as a fix round instead of aborting the pipeline. Same retry cap as a suite failure. Debug builds are also the only builds in which scenarios are allowed to run.

Serve with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

(SharedArrayBuffer.) One local port; stop/replace the server each export. The server resolves files by path only and ignores the query string, so `?egon_scenario={name}` reaches `index.html` untouched.

Headless Chromium screenshots without a host desktop/X11. Runtime image is `mcr.microsoft.com/playwright:v1.63.0-noble` plus Mesa hardware drivers (`libgl1-mesa-dri`, `libglx-mesa0`, `libegl-mesa0`, `libgbm1`, `libvulkan1`, `mesa-vulkan-drivers`, `mesa-va-drivers`). The stock Playwright image has no Mesa drivers and silently uses SwiftShader. Docker run passes `/dev/dri/renderD128` (never `card1` — that needs DRM master and fails with `amdgpu_get_auth failed`), `--group-add` the host GID of that node, `--ipc=host`, and `--shm-size=2g`. No DISPLAY, X socket, or Xorg. After host PCI changes, confirm the render node with `ls -l /dev/dri/by-path/`. Launch Chromium with `--use-gl=angle --use-angle=vulkan` (`--use-angle=gl` silently falls back to SwiftShader). Before the suite runs, evaluate the WebGL renderer and fail unless it matches `/RADV|AMD/` (expected: `ANGLE (AMD, Vulkan … (RADV POLARIS12) …), radv`).

## GitHub PRs, pivot, merge

**Branch + draft PR** after `PLAN_COMPLETE` and the spec schema check: commit spec on `egon/{slug}-{YYYYMMDDTHHMMSSZ}` (name chosen at plan start and stored on the feature), `git push`, `gh pr create --draft` against `GAME_REPO_BRANCH`. Copy SPEC into `$DATA_DIR/features/{id}/SPEC.md`.

**Un-draft** after the first implementer commit that actually has a diff (`gh pr ready`). Later fix-cycle commits push to the same PR; `gh pr ready` is idempotent. Do not convert back to draft on pivot.

**`deployment.json`:** bump the version vs `origin/$GAME_REPO_BRANCH` on every implementer commit path (`ensureDeploymentBump`). Do not ask the implementer to edit that file. Host deploy watches `deployment.json` on the default branch after merge.

**`/egon-pivot`:** valid from `awaiting_review` or `rejected`. Append the change request (and optional image), re-enter implement + test on the same branch and PR.

**`/egon-stop`:** valid while the locked feature is `planning`, `implementing`, `exporting`, `testing`, `fixing`, or `pivoting`. Cancels the in-flight planner (Claude abort or Cursor cancel) or implementer (and any Discord Q&A waiter), the Godot export, and an in-flight suite run. No PR → `collecting` and release the lock (fresh `/egon-plan` later). With a PR → `awaiting_review` (merge on GitHub, `/egon-retry` to continue the same work, or `/egon-pivot`).

**`/egon-retry`:** valid while the pipeline lock is held in a plan/implement/test state, `awaiting_review`, or `rejected`. Cancels the in-flight Cursor run if any, keeps feature state (or re-enters `pivoting` from review/rejected), and continues the chain. Does not discard uncommitted work.

**Merge:** humans merge on GitHub or click **Merge the feature** on the Discord review-ready message (`gh pr merge --squash`). The bot then runs the same cleanup as a GitHub-side merge. `POST /github/webhook` verifies `X-Hub-Signature-256`, then on `pull_request` `closed` + `merged: true`: fetch, checkout `$GAME_REPO_BRANCH`, pull, stop the web server, delete the export dir, mark `accepted`, **keep** spec copy and screenshots, write `$DATA_DIR/GAME_MAP.md` from the merged tree (Godot version, renderer, main scene, viewport, autoloads, input bindings, physics layer names, per-`.tscn` node trees, per-`.gd` public surface, the Debug bridge table, the **Scenarios** table, and a feature index from each `docs/features/{slug}/SPEC.md` §1 — no LLM), release the pipeline lock, and strip **Merge the feature**. Do **not** post a merge notice. Then wait for the game repo's **Build and deploy** workflow (the same reusable action as lets-vibe-together). Wait on the merge commit (`gh pr view --json mergeCommit`) and ignore any run that started before `mergedAt`, so an earlier deploy is never treated as this one. Wait up to 20 minutes for the run to appear, then `gh run watch`. On success, post a Discord notice in the vibe channel. If Discord is down, do not mark the feature announced — a later `workflow_run` webhook or catch-up can retry.

```
✅ Successfully deployed feature {feature name linked to catalog}. You can [test it live](<$GAME_PUBLIC_URL>) now!
```

If no pending feature (manual deploy), use `owner/repo` as the title. A `workflow_run` webhook for that workflow is an alternate path to the same notice (idempotent per Actions run id). Workflow failure posts `Deploy failed` with a link to the run; the feature stays pending so a re-run can still announce success. Closed without merge → `rejected` and a Discord notice; strip **Merge the feature**; lock stays so humans can `/egon-pivot`. The catalog keeps the feature and labels the PR **closed**. Delete from the catalog removes it and closes the PR if it is still open.

Do **not** poll GitHub on an interval. After a merge (webhook, boot catch-up, or catalog page load), wait on that deploy workflow with `gh run watch`. On boot and when serving the catalog index or a feature page, one `gh pr view` per non-accepted feature that already has a PR number (catch up if a webhook arrived while the process was down, or never arrived). Coalesce overlapping catch-ups and skip a repeat within 10 seconds. Plus a deploy wait if any accepted feature still needs a deploy notice.

## Feature catalog

A public HTTP server (separate from the Godot debug server) binds `0.0.0.0:$FEATURES_HTTP_PORT`:

- Index: Collecting (`collecting` ideas from `/egon-new-feature` and `/egon-add`), Planned (every other state, including in-progress planning before a spec exists), and Implemented (`accepted`), with links to detail. Every card (and its detail page) has a **Delete** action. It prompts for password `ente123`, then `POST /features/{slug}/delete`. Wrong password → 403. Delete removes the feature from the catalog only — it does not revert git. If the feature still has an open GitHub PR, delete closes it (`gh pr close`). A closed-unmerged PR stays in Planned labeled **PR #N (closed)** until someone deletes it.
- Detail `/features/{slug}`: name, state, PR link, collected notes, Discord reference images, SPEC, proof stills and clips, and the full agent log (prompts we sent plus what the agent printed, including tool calls). Images are served at `/features/{slug}/attachments/{file}`.
- Pipeline events append to `$DATA_DIR/events.jsonl` (one global file, one JSON per line, `recordEvent`). The agent log answers what an agent said; this answers what the pipeline did, which is a different question once one feature runs plan → implement → export → suite → fix → export → suite. Recording never throws and never blocks a run: a broken event log must not fail a pipeline. Malformed lines are skipped on read, details are clipped, and the agent-log section on the feature page stays exactly where it is.
- Persist each planner / implementer run under `$DATA_DIR/features/{id}/agent-log.jsonl`, and each suite run under `$DATA_DIR/features/{id}/suite-log.jsonl` (checks, steps, failures — no agent involved). The file is written when the run starts (prompt) and updated as stream events arrive, so a catalog refresh shows in-flight output — not only the finished run. A running entry that has gone silent is marked possibly stuck. If that file is missing, the catalog hydrates from the Cursor agent store using `plannerAgentId` / `implementerAgentId` only when `plannerBackend` is not `"claude"`.
- `/events`: the pipeline event log, GitHub-Actions shaped. One section per feature (newest activity first), one collapsible group per phase (`plan`, `implement`, `export`, `suite`, `fix`, `review`, `merge`, `deploy`), timestamped steps inside, and a per-step disclosure for evidence — Godot stderr, a failing check's expected vs. actual, the schema-gate problems. Consecutive same-phase events form one group, so a feature that went round the loop twice shows two Export groups and two Suite groups rather than one merged blur. The newest group of each feature opens by default; **Expand all** / **Collapse all** cover the rest, and `/events#feature-{slug}` opens one feature. Each feature section has a **Delete** action, and the page has **Delete all**. Both prompt for password `ente123` (same as catalog delete), then `POST /events/{featureId}/delete` or `POST /events/delete`. Wrong password → 403. Delete rewrites `$DATA_DIR/events.jsonl`; it does not delete the feature.
- `/events` is **live**. The page polls `/events/fragment` — the feature sections without the page shell — every few seconds and swaps them in. The fragment carries a content `ETag`, so an unchanged log costs a `304` and no body. Polling pauses while the tab is hidden and backs off after a failed request, so a restarting bot is not hammered. Each group carries a stable `data-group-key` (feature, phase, group start) and each step disclosure a stable `data-detail-key`. The initial page ships the fragment `ETag` so the first poll can 304. The client re-applies the reader's open/closed choices after every swap: a poll must never collapse a group or details disclosure somebody just opened, or scroll the page out from under them.
- The **asset portal** at `/assets`, with `GET /assets/file/{id}` and `GET /assets/thumb/{id}` serving bytes, `GET /assets/part/{id}/{filename}` serving a companion file, `POST /assets` uploading, `POST /assets/{id}` saving description / tags / grid / cell groups / filename, `POST /assets/{id}/replace` swapping bytes, `POST /assets/{id}/attach` adding a companion, `POST /assets/{id}/attach/{filename}/delete` removing one, and `POST /assets/{id}/delete` removing an asset. Every **write** route is guarded by the same `ente123` password as delete — no new secret and no new env var. Every id goes through the same resolve-then-verify-prefix guard as the feature-attachment route.
- `POST /github/webhook` as above.

Catalog reads SQLite plus `$DATA_DIR/features/{id}/` so it does not depend on which git branch is checked out.

## Docker (final image, built incrementally)

Single service. Long-running Node bot (`docker --init`). Persist `/data` and optionally `/game`. Clone from `GAME_REPO_HTTPS_URL` at boot. No Cursor IDE. Chromium (ANGLE Vulkan on RADV), Godot CLI, git, a small agent CLI toolkit (`python3`, `jq`, `ripgrep`, `xxd`, and similar), and a pinned `gh` binary belong in the image. Publish `FEATURES_HTTP_PORT`.

```
/app          bot source
/game         cloned Godot repo (GAME_REPO_DIR)
/data         sqlite, Cursor agent store, Claude sessions, screenshots, attachments, specs
```

Node.js **22.13+** (required by `@cursor/sdk`).

## Answers to open questions

1. **Does Cursor need a browser to debug the game?** Local SDK agents have no built-in browser. Only the scenario suite needs Chromium in the container, driven by Playwright directly. Planner and implementer only need the game repo on disk.
2. **Headless host and screenshots?** Need Chromium + Mesa Vulkan drivers in the image and the host render node (`renderD128`), not a desktop session or X11. Playwright headless screenshots without DISPLAY. Use `--use-angle=vulkan`; `--use-angle=gl` and the stock Playwright image silently fall back to SwiftShader. Assert `/RADV|AMD/` on the WebGL renderer.

## Out of scope

- Multiple game repos
- Non-web Godot exports
- Cursor cloud runtime
- Cursor IDE in the container
- Bot merging the PR
- Parallel implement/test of two features
- Discord as an asset intake. An attached image is reference material an agent looks at, never a file the game ships; game content comes from the asset portal.
- An LLM or vision call anywhere in the asset path. The human describes; the machine measures. A fact that cannot be measured and was not typed is not known.
- Asset formats needing a tool the Docker image does not have (FBX2glTF, Blender, the Aseprite CLI, `sharp`, ImageMagick). They are rejected with a reason, not converted.
- An in-engine Godot test framework (GUT, GdUnit4). They run in the Godot runtime, not the browser, so they go green on a build that is broken in Chromium — which is the failure class this pipeline exists to catch. They are also addons, and the implementer is told to depend on none.
