# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 3 — scheduler / reminders)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `bin/main.dart` — loads `Config`, wires up all services, connects to the Discord
  gateway, and keeps the bot online with a reconnect loop.
- `lib/src/scheduler/` — 30s tick over `scheduled_tasks`; `message` posts verbatim,
  `agent` runs a full turn; GPU-busy agent tasks defer +5 min; boot recovery fires
  one-shots ≤6h late with "(delayed)", marks older ones `missed`, and skips recurring
  to the next cron occurrence. 5-field cron is evaluated in `BOT_TIMEZONE` (DST-aware).
- `lib/src/agent/` — conversational turn + `ApprovalService` (preview/dangerous buttons).
- `lib/src/memory/` — FTS5 memories; DM auto-capture; `conversation_log` (200/channel).
- `lib/src/llm/` — Ollama client + `LlmGate` (GPU queue / CPU utility tier).
- `lib/src/tools/` — includes scheduler tools (`schedule_task`, `list_scheduled_tasks`,
  `cancel_scheduled_task`) plus web, whitelist, and memory tools.
- `lib/src/storage/` — SQLite at `$DATA_DIR/egon.db` with versioned migrations.
- `lib/src/integrations/windows_monitor_client.dart` + `tools/windows_monitor_api.dart` —
  the GPU monitor sidecar and its client.

Next up: Phase 4 (jobs — deep research, cancellation, resume).

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
