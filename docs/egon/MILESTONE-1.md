# Milestone 1 — Working Discord bot with commands

Closed work order. If this conflicts with [SPEC.md](SPEC.md), SPEC wins — stop and ask.

## Goal

Ship a containerized TypeScript Discord bot: slash commands, SQLite feature store, thread Q&A plumbing, Docker skeleton. **No Cursor agents and no Godot.**

## Out of scope

- Do not start milestone 2 or 3.
- Do not add `@cursor/sdk`, Godot, Playwright, or Chromium.
- Do not clone or edit the game repo beyond whatever env validation needs (clone can wait until M2 if easier; still declare the env vars).
- Do not implement real `/egon-plan` / accept / reject / pivot pipelines. Stub them as "not wired yet" where needed.

## Prerequisites

None. Empty repo except this handoff pack.

## Stack

- Node.js 22.13+ (SDK later; pin now)
- TypeScript, ESM, `src/` → `dist/`
- discord.js v14
- better-sqlite3 or `node:sqlite`
- Volume `/data` for SQLite

## Files to create

- `package.json` / `tsconfig.json`
- `src/index.ts` — login, register commands, graceful shutdown
- `src/config.ts` — env validation (`DISCORD_CHANNEL_ID`, `GAME_REPO_HTTPS_URL`, and the rest from SPEC)
- `src/discord/commands.ts` — command registry (source of truth for `/egon-help`)
- `src/discord/handlers.ts` — command routing; drop interactions not from `DISCORD_CHANNEL_ID`
- `src/discord/threads.ts` — mention-as-answer collector (used for real in M2)
- `src/features/store.ts` — SQLite: features, notes, pipeline lock, latest-per-channel
- `src/features/state.ts` — allowed transitions from SPEC
- `Dockerfile` / `docker-compose.yml` / `.env.example`

Keep Docker thin: Node bot only. Godot and Chromium come in M3.

## Behavior

- Enable Message Content Intent, Guilds, GuildMessages.
- Guild-register commands on `DISCORD_GUILD_ID`.
- Commands only work in `DISCORD_CHANNEL_ID`.
- `/egon-new-feature` creates a feature in `collecting` and sets channel latest.
- `/egon-add` targets latest feature in that channel; error if none.
- `/egon-add-to-feature` appends to a named feature.
- `/egon-list` returns open features (not `accepted`) with name, state, note count.
- `/egon-help` posts registry descriptions (ephemeral).
- `/egon-status` reports current pipeline feature + state (or none).
- `/egon-plan` / `/egon-accept` / `/egon-reject` / `/egon-pivot`: persist Discord message/thread ids as needed; `/egon-plan` may take the pipeline lock and reply "not wired yet".
- Persist Discord message/thread ids on the feature row so Q&A can attach later.
- Thread helper: first message in the thread that mentions the bot wins. Make this unit-testable without Discord.

## Test plan

- Bot starts from Docker with required env; fails fast if env is missing.
- Slash commands appear in the configured guild.
- Create / add / add-to-feature / list / help / status work and survive process restart (SQLite on `/data`).
- Commands from another channel are ignored.
- Unit test the "first mention wins" thread helper.

## Done when

- [ ] Containerized bot registers commands from env
- [ ] help / list / create / add / status work across restart
- [ ] Commands outside `DISCORD_CHANNEL_ID` are ignored
- [ ] Thread helper has a unit-testable "first mention wins" function
- [ ] No Cursor SDK, Godot, or Playwright in this milestone
