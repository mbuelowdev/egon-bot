# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 10 — Hardening)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- Gateway watchdog, monitor-down owner ping, daily SQLite backup/restore,
  `review_audit_log`, graceful-restart queue notices.
- Watchers + `http_request`, Google Calendar, media + contacts, Obsidian,
  self-extension, jobs, scheduler, approvals, memory, GPU-gated LLM.

Architecture phases 1–10 are complete. Optional extras (morning briefing, etc.)
are listed under Deferred in the implementation plan.

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN and OWNER_USER_ID
dart pub get
dart run tool/generate_tool_registry.dart   # after adding/removing builtin tools
dart run bin/main.dart
```

### Google Calendar setup (one-time)

1. Google Cloud Console → enable Calendar API → OAuth **Desktop** client.
2. Export `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (and `DATA_DIR` if needed).
3. `dart run tool/google_calendar_setup.dart` — open the URL, paste the code.
4. Credentials land in `$DATA_DIR/google/token.json` + `config.json` (Egon calendar id).

Run the tests with `dart test`.

## Deployment

Docker image built from `Dockerfile` (supervisor ENTRYPOINT). Deploy via GitHub Actions
on `deployment.json` version bumps. Mount `/data` so Google tokens and the vault persist.
