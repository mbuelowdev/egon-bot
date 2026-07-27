# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (seed)

- `bin/main.dart` — loads config, connects to the Discord gateway, and keeps the bot
  online with a reconnect loop.
- `lib/src/discord/message_loop.dart` — replies via Ollama when the bot is DM'd or
  mentioned. Proof-of-life only; the agent core from the architecture doc replaces this.
- `lib/src/llm/` — Ollama `/api/chat` client with tool-calling support.
- `lib/src/integrations/windows_monitor_client.dart` + `tools/windows_monitor_api.dart` —
  the GPU monitor sidecar (runs on the Windows machine hosting Ollama) and its client.
  The GPU is shared with games, so Ollama is only called while the monitor reports it
  free; the full design queues requests instead (ARCHITECTURE.md §5.1). Leave
  `WINDOWS_MONITOR_API_BASE_URL` unset to disable gating during development.

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN
dart pub get
dart run bin/main.dart
```

Requires a reachable Ollama instance (`OLLAMA_API_BASE_URL`, default
`http://127.0.0.1:11434`) with a tool-calling-capable model pulled
(`OLLAMA_MODEL`, default `gpt-oss:20b`).

## Deployment

Docker image built from `Dockerfile`; deployed via the GitHub Actions workflow, which
triggers on changes to `deployment.json` (bump `version` to deploy).
