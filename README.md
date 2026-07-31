# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 4 — jobs)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `lib/src/jobs/` — long-running planned work: big-model JSON planner (2–10 steps),
  singleton sequential `JobRunner`, progress posts, `waiting_user` clarifying questions,
  cancel between tool calls/steps (tool + natural-language via utility model), and
  resume-on-boot from the current step.
- `lib/src/scheduler/` — reminders/cron with downtime recovery and GPU deferral.
- `lib/src/agent/` — conversational turn + `ApprovalService` (preview/dangerous buttons).
- `lib/src/memory/` — FTS5 memories; DM auto-capture; `conversation_log` (200/channel).
- `lib/src/llm/` — Ollama client + `LlmGate` (GPU queue / CPU utility tier; `format` for
  structured plans).
- `lib/src/tools/` — `start_job`, `cancel_job`, `status_overview`, plus scheduler, web,
  whitelist, and memory tools.
- `lib/src/storage/` — SQLite at `$DATA_DIR/egon.db` with versioned migrations.

Next up: Phase 5 (self-extension runtime — generate tools and restart safely).

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN and OWNER_USER_ID
dart pub get
dart run bin/main.dart
```

Run the tests with `dart test`.

Requires a reachable Ollama instance (`OLLAMA_API_BASE_URL`, default
`http://127.0.0.1:11434`) with a tool-calling-capable model pulled
(`OLLAMA_MODEL`, default `gpt-oss:20b`).

## Deployment

Docker image built from `Dockerfile`; deployed via the GitHub Actions workflow, which
triggers on changes to `deployment.json` (bump `version` to deploy).
