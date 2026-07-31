# Egon Bot

Personal task executor and daily assistant living on Discord, powered by a local
[Ollama](https://ollama.com) instance. Written in Dart.

The project was reset to a minimal seed (Discord gateway + Ollama client) and is being
rebuilt from scratch. **The full target design lives in [ARCHITECTURE.md](ARCHITECTURE.md)**
— read that first.

## Current state (Phase 6 — Obsidian)

Implemented so far (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)):

- Obsidian vault via `obsidian-headless` sidecar — sandboxed `ObsidianVault`, six
  personal note tools with unified-diff approval, idea capture to `Inbox/Ideas.md`,
  research jobs plan a vault report under `Inbox/Research/`.
- `supervisor/entrypoint.sh` — tool sync, Obsidian login/sync-setup/continuous sidecar,
  registry codegen, exit `0` / `42` / crash backoff + quarantine.
- Jobs, scheduler, approvals, memory, GPU-gated LLM queue, self-extension (`create_tool`).

Next up: Phase 7 (media + contacts — voice, attachments, address book).

## Running locally

```bash
cp .env.example .env   # fill in DISCORD_BOT_TOKEN and OWNER_USER_ID
dart pub get
dart run tool/generate_tool_registry.dart   # after adding/removing builtin tools
dart run bin/main.dart
```

Local runs use `$DATA_DIR/vault` as a plain directory (no Sync required). In Docker,
set `OBSIDIAN_EMAIL`, `OBSIDIAN_PASSWORD`, and `OBSIDIAN_VAULT_NAME` for Headless Sync.

Run the tests with `dart test`.

## Deployment

Docker image built from `Dockerfile` (ENTRYPOINT is the supervisor; includes Node 22 +
`obsidian-headless`); deployed via the GitHub Actions workflow on `deployment.json`
version bumps.
