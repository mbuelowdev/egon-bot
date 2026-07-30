# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 2 — approvals + memory)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `bin/main.dart` — loads `Config`, wires up all services, connects to the Discord
  gateway, and keeps the bot online with a reconnect loop.
- `lib/src/agent/` — conversational turn with persona prompts, FTS memory injection
  (`## Things you remember`), and a bounded model↔tool loop. `ApprovalService` posts
  Approve/Reject buttons for preview/dangerous calls, persists them across restarts,
  and runs the tool with an "Applied ✔" follow-up once Michael clicks.
- `lib/src/memory/` — long-term memories with FTS5 recall; every accepted DM is
  auto-captured. Guild history lives in `conversation_log` (pruned to 200/channel).
- `lib/src/llm/` — Ollama `/api/chat` client plus the `LlmGate` (GPU-gated big-model
  queue, CPU-only utility tier, VRAM eviction). Leave `WINDOWS_MONITOR_API_BASE_URL`
  unset to disable gating during development.
- `lib/src/tools/` — access tiers + approval wiring; tools include `list_tools`,
  `web_search`, `fetch_url`, whitelist helpers, and memory tools (`remember`,
  `recall_memories`, `forget_memory`, `list_memories`).
- `lib/src/storage/` — SQLite at `$DATA_DIR/egon.db` with versioned migrations.
- `lib/src/integrations/windows_monitor_client.dart` + `tools/windows_monitor_api.dart` —
  the GPU monitor sidecar and its client.

Next up: Phase 3 (scheduler / reminders).

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
