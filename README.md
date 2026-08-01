# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 9 — Watchers + API usage)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- `watch_url` scheduled scrapers (snapshot diff + utility condition check) and
  owner-only `http_request` with SSRF blocking / mutation previews.
- Google Calendar, media + contacts, Obsidian, self-extension, jobs, scheduler,
  approvals, memory, GPU-gated LLM.

Next up: Phase 10 (hardening).

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
