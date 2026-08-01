# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 7 — media + contacts)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- Attachments downloaded to `$DATA_DIR/files/` (size-capped); voice messages transcribed
  with ffmpeg + whisper.cpp; recent files injected into context; `read_stored_file`.
- Address book: `add_contact` / `update_contact` / `list_contacts` / `send_to_contact`
  with name resolution, ambiguity ask-back, document resolution, diff-style delivery
  preview, DM with channel fallback.
- Obsidian vault, self-extension, jobs, scheduler, approvals, memory, GPU-gated LLM.

Next up: Phase 8 (Google Calendar).

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN and OWNER_USER_ID
dart pub get
dart run tool/generate_tool_registry.dart   # after adding/removing builtin tools
dart run bin/main.dart
```

Voice transcription needs `ffmpeg` and `whisper-cli` on `PATH` plus a ggml model
(`WHISPER_MODEL_PATH`, default `/models/ggml-small.bin`). The Docker image includes
these; local runs without them still handle text + attachments.

Run the tests with `dart test`.

## Deployment

Docker image built from `Dockerfile` (supervisor ENTRYPOINT; Node 22 + Obsidian
Headless; ffmpeg + whisper.cpp `small` model + poppler). Deploy via GitHub Actions on
`deployment.json` version bumps.
