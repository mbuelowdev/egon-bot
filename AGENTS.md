# AGENTS.md

## Cursor Cloud specific instructions

Egon Bot is a single Dart service: a personal-assistant Discord bot (`nyxx`
gateway) whose "brain" is a local [Ollama](https://ollama.com) instance, with
SQLite state under `DATA_DIR`. There is no web/UI component. See `README.md` for
the standard commands and `ARCHITECTURE.md` for the full design.

### Everyday commands (already documented, repeated here for convenience)
- Install deps: `dart pub get`
- Lint / analyze: `dart analyze`
- Tests: `dart test`
- Run the bot (dev): `dart run bin/main.dart`
- Regenerate the tool registry after adding/removing a builtin tool:
  `dart run tool/generate_tool_registry.dart` (writes the committed
  `lib/src/tools/tool_registry.g.dart`; not needed on a normal boot since it is
  already committed).

### Non-obvious caveats
- System deps live in the VM snapshot, not the update script: the Dart SDK and
  **`libsqlite3-dev`** are installed at environment-build time. `libsqlite3-dev`
  (not just `libsqlite3-0`) is required — Dart's `sqlite3` FFI needs the
  `libsqlite3.so` symlink that only the `-dev` package provides.
- The update script only runs `dart pub get`. The tool-registry codegen is not
  run on boot because its output is committed; run it manually when you change
  the builtin tool set.
- Running `bin/main.dart` requires `DISCORD_BOT_TOKEN` and `OWNER_USER_ID`
  (missing either makes it exit `64` with a `ConfigError`). For local dev set
  `DATA_DIR` to a writable path such as `./data` (the container default is
  `/data`). Full message handling additionally needs a reachable Ollama serving
  `OLLAMA_MODEL` (default `gpt-oss:20b`, GPU-class); without it the bot still
  boots and connects to Discord but cannot generate replies.
- The tests are self-contained (in-memory SQLite + a `FakeOllama`); they do not
  need Discord, Ollama, or network access. `ffmpeg` must be on `PATH` for the
  `discord_image` webp→png tests (it ships with the environment).
- Known time-dependent test failure (NOT an environment problem):
  `test/scheduler_test.dart` → `schedule tools schedule_task + cancel_scheduled_task round trip`
  hardcodes `due_at = 2026-08-02`, while `ScheduleTaskTool` validates `due_at`
  against the real wall clock (`DateTime.now()`), so it fails on any date after
  2026-08-02. Everything else passes.
