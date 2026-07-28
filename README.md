# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 1 — core agent)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `bin/main.dart` — loads `Config`, wires up all services, connects to the Discord
  gateway, and keeps the bot online with a reconnect loop.
- `lib/src/agent/` — the conversational turn: persona prompts (German Egon in group
  channels, neutral assistant in DMs), rolling channel history as context, and a bounded
  model↔tool loop.
- `lib/src/llm/` — Ollama `/api/chat` client plus the `LlmGate`: every big-model call
  goes through a FIFO queue that only dispatches while the shared GPU is free (Windows
  monitor sidecar). While it's busy, interactive turns run on the small CPU-only utility
  model (`num_gpu: 0`), which can hand hard requests back via `defer_to_big_model` —
  they're queued and answered when the GPU frees up. On user activity the big model is
  evicted from VRAM. Leave `WINDOWS_MONITOR_API_BASE_URL` unset to disable gating during
  development.
- `lib/src/tools/` — the `Tool` interface with access tiers (`standard` / `personal` /
  `dangerous`), a registry with per-caller enforcement and an SQLite audit log, and the
  first five tools: `list_tools`, `web_search`, `fetch_url`, `whitelist_user`,
  `unwhitelist_user`.
- `lib/src/storage/` — SQLite at `$DATA_DIR/egon.db` with versioned migrations
  (whitelist + tool audit log so far).
- `lib/src/integrations/windows_monitor_client.dart` + `tools/windows_monitor_api.dart` —
  the GPU monitor sidecar (runs on the Windows machine hosting Ollama) and its client.

Next up: Phase 2 (memory, persistent conversation log, and the approval flow).

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
