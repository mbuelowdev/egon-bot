# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 5 — self-extension)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `supervisor/entrypoint.sh` — syncs `/data/tools` → `generated/`, regenerates the
  registry, runs the bot, honours exit `0` / `42` / crash backoff, quarantines
  crash-looping self-written tools.
- `tool/generate_tool_registry.dart` — discovers `builtin/` + `generated/` tools and
  emits `tool_registry.g.dart`.
- `create_tool` / `restart_self` — dangerous tools; codegen via the big model with
  import whitelist + `dart analyze` (≤3 repair rounds), then exit 42 + post-boot notice.
- `lib/src/jobs/` — long-running planned work with cancel/resume.
- `lib/src/scheduler/` — reminders/cron with downtime recovery and GPU deferral.
- `lib/src/agent/` — conversational turn + `ApprovalService` (preview/dangerous buttons).
- `lib/src/memory/` — FTS5 memories; DM auto-capture; `conversation_log`.
- `lib/src/llm/` — Ollama client + `LlmGate` (GPU queue / CPU utility tier).
- `lib/src/storage/` — SQLite at `$DATA_DIR/egon.db` with versioned migrations.

Next up: Phase 6 (Obsidian vault sync + diff-approved note tools).

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN and OWNER_USER_ID
dart pub get
dart run tool/generate_tool_registry.dart   # after adding/removing builtin tools
dart run bin/main.dart
```

For the full supervisor loop (tool sync + restart protocol), run
`supervisor/entrypoint.sh` with `DATA_DIR` pointing at a writable directory
(default `/data`).

Run the tests with `dart test`.

Requires a reachable Ollama instance (`OLLAMA_API_BASE_URL`, default
`http://127.0.0.1:11434`) with a tool-calling-capable model pulled
(`OLLAMA_MODEL`, default `gpt-oss:20b`).

## Deployment

Docker image built from `Dockerfile` (ENTRYPOINT is the supervisor); deployed via the
GitHub Actions workflow, which triggers on changes to `deployment.json` (bump `version`
to deploy).
