# Egon Bot — Implementation Plan

Step-by-step build plan derived from [ARCHITECTURE.md](ARCHITECTURE.md). Section
references (§) point there. Phases match §19; each phase ends with a deployable bot and
an acceptance check. Work top to bottom — every phase only depends on the ones before it.

Conventions for every phase:

- `dart analyze` and `dart format` stay clean; new logic gets unit tests where noted.
- Deploy after each phase by bumping `version` in `deployment.json`.
- New tables are added via `lib/src/storage/migrations.dart` with a bumped
  `schema_version` pragma — never by editing old migrations.

---

## Phase 1 — Core agent ✅ implemented

**Goal:** mention/DM → context → Ollama tool loop → reply, with access control and the
GPU respected. Replaces the seed's proof-of-life loop.

Steps:

1. Dependencies: add `sqlite3`, `timezone`, `html`, `cron` (or hand-rolled cron parser
   later, §8) to `pubspec.yaml`; add `libsqlite3-0` to the Docker image.
2. `lib/src/config.dart` — typed env access for every variable in §15, secret-redacting
   `toString()`.
3. `lib/src/storage/database.dart` + `migrations.dart` — open/migrate `/data/egon.db`
   (`DATA_DIR`), `schema_version` pragma. First migration: `whitelisted_users`,
   `tool_audit_log` (§6.2, §16).
4. `lib/src/tools/tool.dart` — `Tool` abstract class exactly as §6.1: `name`,
   `description`, `parametersJsonSchema`, `ToolAccess get access`, `previewChange`
   (default null), `execute`. Plus `ToolContext`, `ToolResult`, `Services`.
5. `lib/src/tools/tool_registry.dart` — hand-written tool list for now (codegen comes in
   Phase 5), schema export for Ollama, dispatch with `ToolAccess` enforcement
   (approval escalation stubs return "not yet supported" until Phase 2) and audit
   logging.
6. `lib/src/llm/llm_gate.dart` — single-worker FIFO queue in front of `OllamaClient`
   (§5.1): `ModelTier.big|small`, GPU poll (`isUserActive` OR `avg5m >
   GPU_BUSY_THRESHOLD_PERCENT`, monitor unreachable = busy), re-poll every
   `GPU_POLL_INTERVAL_SECONDS`, queue cap 20, interactive TTL 6 h, VRAM unload
   (`keep_alive: 0`) when the user becomes active.
7. `lib/src/agent/` — `agent.dart` (one turn), `context_builder.dart` (history window;
   memory injection lands in Phase 2), `tool_loop.dart` (bounded rounds, forced final
   answer, ported from git history `2bca07a`), `prompts.dart` (English Egon persona for
   guild channels, neutral assistant voice for owner DMs — §18).
8. Degraded mode (§5.1): GPU busy → turn runs on the utility model with full toolset +
   `defer_to_big_model` tool that queues the turn as a big job and posts the interim
   notice.
9. `lib/src/discord/message_router.dart` — replaces `message_loop.dart`: channel
   whitelist, user whitelist (owner implicit), DM vs guild routing, per-channel history.
   `discord_actions.dart` — send with >2 000-char splitting.
10. Built-in tools: `list_tools`, `web_search`, `fetch_url` (both ported from
    `2bca07a`), `whitelist_user`, `unwhitelist_user`.
11. Unit tests: registry access enforcement, gate tier routing (fake monitor), tool-loop
    round limit.

**Acceptance:** mention in a whitelisted channel gets a tool-looped answer (web search
works); a non-whitelisted user is ignored; with the monitor faked "busy" the reply comes
from the utility model; `list_tools` names every registered tool.

## Phase 2 — Approvals + memory ✅ implemented

**Goal:** the approval machinery every later phase leans on, plus persistent memory.

Steps:

1. Migration: `pending_approvals` (§6.5), `memories` + `memories_fts` (FTS5),
   `conversation_log` (§7).
2. `lib/src/agent/approval_service.dart` — post preview + Approve/Reject buttons
   (nyxx message components), owner-only clicks, 24 h expiry, persistence, listener
   restore after restart, "applied ✔" follow-up when the originating turn is gone.
3. Wire into `ToolRegistry.dispatch`: non-null `previewChange` → pause & approve;
   `dangerous` tool requested by non-owner → escalate in-channel (§16 matrix).
4. `lib/src/memory/memory_service.dart` — store/search (FTS)/forget; DM auto-capture
   (`source='dm'`); guild messages into `conversation_log` pruned at 25/channel.
5. Context builder: automatic FTS query per incoming message, top-5 hits injected as
   `## Things you remember`.
6. Tools: `remember`, `recall_memories`, `forget_memory`, `list_memories` (owner DM
   only).
7. Unit tests: approval expiry, FTS recall, owner-only button enforcement.

**Acceptance:** a DM'd fact resurfaces in a later conversation without being asked;
approval buttons survive a bot restart; a non-owner clicking Approve is rejected
ephemerally.

## Phase 3 — Scheduler (reminders) ✅ implemented

**Goal:** "remind me next Thursday 8 am to tie my shoes" works end to end.

Steps:

1. Migration: `scheduled_tasks` incl. `state_json` (§8).
2. `lib/src/scheduler/recurrence.dart` — 5-field cron parse + next-occurrence in
   `BOT_TIMEZONE`; unit-test DST boundaries.
3. `lib/src/scheduler/scheduler.dart` — 30 s tick, due-task query, `message` kind posts
   verbatim (no LLM), `agent` kind runs an agent turn in the stored channel; GPU
   interplay: `agent` tasks deferred +5 min while gate busy; recurring next-run update.
4. Boot downtime policy: ≤6 h late → fire "(delayed)"; older → `missed` + owner notice;
   recurring skip to next occurrence.
5. Tools: `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`. Current
   date/time in prompt so the model converts natural language to ISO/cron itself;
   server-side validation errors feed back to the model.
6. Unit tests: recurrence math, downtime policy branches.

**Acceptance:** "remind me in 2 minutes …" fires in-channel; a reminder scheduled, then
bot restarted before it's due, still fires; a recurring task fires and reschedules.

## Phase 4 — Jobs (deep research, cancellation, resume) ✅ implemented

**Goal:** long-running planned work — the wood-sealing scenario minus the Obsidian
report (that arrives in Phase 6).

Steps:

1. Migration: `jobs` table (§9).
2. `lib/src/jobs/planner.dart` — instructions → 2–10 step plan via big-model JSON call
   (Ollama `format` parameter).
3. `lib/src/jobs/job_runner.dart` — singleton sequential worker: plan post, per-step
   bounded tool loop with prior-step summaries, persist plan status + `progress_log`
   after each step, progress posts for >2-step jobs, big-tier gate pauses noted in log.
4. Cancellation (§9): `cancel_job` tool + natural-language intent check — while a job
   runs, owner messages in its channel are classified by the utility model; flag checked
   between tool calls and steps; cancelled jobs post partial findings.
5. `waiting_user`: step asks a question → job parks, next queued job may start; owner
   reply re-queues it at the front.
6. Resume on boot: `running` → restart current step + "resuming ⟨title⟩ at step n/m";
   `queued`/`waiting_user` untouched.
7. Tools: `start_job`, `cancel_job`, `status_overview` (jobs, queue, questions, next 5
   scheduled tasks, watchers, pending approvals, gate state — §9).
8. Unit tests: runner state machine (queued→planning→running→done/cancelled/waiting),
   resume-from-step, cancel flag between steps.

**Acceptance:** a research request produces a plan, executes sequentially, and posts a
digest; "stop researching about X" cancels mid-job with partial findings; killing the
container mid-job resumes at the same step after restart; `status_overview` reflects all
of it.

## Phase 5 — Self-extension runtime ✅ implemented

**Goal:** the bot writes its own tools and restarts into them safely.

Steps:

1. `supervisor/entrypoint.sh` (§3): sync `/data/tools/*.dart` →
   `lib/src/tools/generated/`, registry codegen, `dart pub get`, run bot; exit-code
   protocol (0 stop / 42 restart / else backoff 5 s→300 s); crash-loop quarantine (≥3
   crashes in 10 min + changed tool → move newest to `/data/tools/quarantine/`).
2. `tool/generate_tool_registry.dart` — scan `builtin/` + `generated/`, validate the
   file/class conventions (§6.3), emit `tool_registry.g.dart`; switch the registry to
   the generated list.
3. Dockerfile: `ENTRYPOINT ["supervisor/entrypoint.sh"]`; `deployment.json`: mount the
   `/data` volume; `.gitignore`: `lib/src/tools/generated/`.
4. `create_tool` (`dangerous`, §6.4): big-model codegen with the `Tool` interface +
   conventions in the prompt; staging + `dart analyze` gate with ≤3 repair rounds;
   import whitelist (`dart:*`, `package:http`, `tool.dart`); name-collision check;
   `pending_notice` row → exit 42 → post-boot "tool X is live".
5. `restart_self` (`dangerous`): exit 42.
6. Escalation already works via Phase 2: non-owner `create_tool` requests ask the owner
   in-channel.

**Acceptance:** "build yourself a tool that rolls dice" → analyze-clean tool installed →
restart → tool appears in `list_tools` and works; a deliberately broken file dropped
into `/data/tools/` gets quarantined and reported instead of crash-looping.

## Phase 6 — Obsidian ✅ implemented

**Goal:** vault synced into the container; diff-approved note edits; research reports
and idea capture complete.

Steps:

1. Image: Node.js 22 + `npm install -g obsidian-headless`.
2. Entrypoint (§13): idempotent `ob login` / `ob sync-setup` from `OBSIDIAN_*` env vars,
   `ob sync --continuous` sidecar with independent restart; failures non-fatal → note
   tools report "vault sync unavailable".
3. `lib/src/integrations/obsidian_vault.dart` — path sandbox (resolved inside vault
   root), full-vault write access, atomic writes, unified-diff generation for previews.
4. Tools (`personal`, mutations preview-approved): `obsidian_list_notes`,
   `obsidian_read_note`, `obsidian_write_note`, `obsidian_append_note`,
   `obsidian_delete_note`, `obsidian_search_notes`.
5. Persona addition: idea-capture instructions (evaluate vs. append to
   `Inbox/Ideas.md`, ask when unclear — §10).
6. Job reporting (§9): research jobs write the full document to the vault
   (diff-approved) + channel digest.
7. Unit tests: path-traversal attempts rejected, diff rendering, atomic write.

**Acceptance:** "save this idea: …" → diff shown → Approve → note appears on your other
Obsidian devices; a research job delivers its report as a vault document; path escapes
(`../`) are refused.

## Phase 7 — Media + contacts ✅ implemented

**Goal:** voice input, attachments, and "send this document to Jan".

Steps:

1. Migration: `files`, `contacts` tables (§10, §14).
2. Image: `ffmpeg`, `whisper.cpp` binary + `ggml-small` model (`WHISPER_MODEL`),
   `poppler-utils` (pdftotext).
3. `lib/src/media/attachments.dart` — download ≤ `MAX_ATTACHMENT_MB` to `/data/files/`,
   record rows, inject recent file records into context ("this document" resolution);
   read text-like attachments on request.
4. `lib/src/media/transcription.dart` — ogg/opus → wav → whisper; transcript enters the
   normal turn prefixed `(voice message)`; failure → "please type it" (§17).
5. `lib/src/contacts/contacts_service.dart` + tools (`personal`): `add_contact`,
   `update_contact`, `list_contacts`, `send_to_contact` — resolution
   (exact/alias/ambiguous→ask back; in jobs → `waiting_user`), document resolution
   (recent attachment | URL | vault note | job artifact), preview approval, DM delivery
   with in-channel fallback (§14).
6. Unit tests: contact resolution incl. ambiguity, attachment cap.

**Acceptance:** a voice DM gets a correct answer to its content; "send this document to
Jan" with two Jans in the book triggers the "Which Jan?" question, then delivers after
approval.

## Phase 8 — Google Calendar ✅ implemented

**Goal:** calendar read everywhere, writes to the dedicated "Egon" calendar.

Steps:

1. One-time (manual, documented in the setup script's output): create Google Cloud
   project, enable Calendar API, create OAuth Desktop-app client.
2. `tool/google_calendar_setup.dart` — consent URL → code paste →
   `/data/google/token.json`; creates the "Egon" calendar if missing and stores its id
   in `/data/google/config.json` (§12).
3. `lib/src/integrations/google_calendar_client.dart` — `googleapis` +
   `googleapis_auth`, auto-refresh, revoked-token → "re-run setup" error.
4. Tools (`personal`, mutations preview-approved): `calendar_list_events` (all visible
   calendars), `calendar_create_event`, `calendar_update_event`,
   `calendar_delete_event` (Egon calendar only). Europe/Berlin ↔ RFC 3339 conversion.

**Acceptance:** "what's on my calendar tomorrow?" lists real appointments; "add dentist
Friday 10:00" → preview → Approve → event in the Egon calendar, visible in the Google
Calendar UI.

## Phase 9 — Watchers + API usage ✅ implemented

**Goal:** scheduled scrapers and ad-hoc API calls.

Steps:

1. `lib/src/scheduler/watcher.dart` + `watch_url` tool (§8): recurring `watch` task;
   fetch → snapshot compare (`state_json`) → utility-model condition check → alert with
   evidence quote; `until_triggered` default; 15 min minimum interval; 3-per-user cap
   (owner uncapped); 3 consecutive fetch failures → owner warning (§17).
2. `http_request` tool (`personal`, §11): non-GET → preview approval with the exact
   request; private/loopback IP ranges blocked (resolve before connect).
3. API-analysis playbook in the prompts: probe `/openapi.json`, `/swagger.json`, docs
   links; summarize endpoints/auth; use `http_request`; suggest `create_tool` for
   recurring use.
4. Unit tests: private-IP blocking, snapshot-diff triggering, watcher caps.

**Acceptance:** a watcher on a test page announces a change within one interval and
closes itself; "check the JSON API of ⟨site⟩ and fetch X" works via GET without
approval; a POST shows the exact request first.

## Phase 10 — Hardening ✅ implemented

**Goal:** boring reliability.

Steps:

1. Gateway watchdog: no events/heartbeat for 10 min → `exit(1)` (§3 Layer 3).
2. Monitor-down notice: >15 min unreachable with queued jobs → single owner ping (§5.1).
3. DB backup: daily rotate to `/data/state/egon.db.bak`, restore-on-corruption path
   (§17).
4. Audit review: "what did you do today?" rendering of `tool_audit_log` (§18 extra 2 —
   cheap here).
5. Graceful-restart queue notice: exit-42 posts "please re-send" to channels with queued
   interactive jobs (§5.1).
6. Test sweep: scheduler recurrence, vault sandbox, approval expiry, job resume, gate
   policy — everything §19 names.

**Acceptance:** kill -9, container restart, monitor outage, and Ollama outage each
recover without manual help and without silent work loss.

## Phase 11 — Cursor self-extension ✅ implemented

**Goal:** durable self-extension via Cursor Cloud Agents + GitHub PR, with Discord
plan approval. Local `create_tool` stays as the trivial fast path.

Steps:

1. Config: `CURSOR_API_KEY`, `CURSOR_REPO_URL`, `CURSOR_STARTING_REF`, `CURSOR_MODEL`.
2. `CursorAgentsClient` + `self_extensions` table + `pending_approvals.kind`.
3. `SelfExtensionRunner`: plan → await approval → revise → implement → awaiting_merge
   → done when `deployment.json` version matches; single-flight; cancel + poll.
4. Discord: `egon:ext-approve:` / `egon:ext-reject:`; owner reply = revision notes;
   `status_overview` / `cancel_job` / busy CANCEL cover open extensions.
5. `extend_self` tool + agent prompts (vs `create_tool`); registry codegen.
6. `deployment.json` env wiring; ARCHITECTURE §6.4 rewrite.

**Acceptance:** `extend_self` posts a plan → revise via message → approve → PR with
bumped `deployment.json` → merge → bot reports live at new version. Concurrent second
extension rejected. Local dice-roller still uses `create_tool` without a PR.

**Owner setup (manual):** Cursor API key + GitHub repo connected to Cloud Agents;
add `CURSOR_API_KEY` to host env / deploy; optional branch protection on `master`.

---

## Deferred / optional (§18 — pending yes/no)

- Morning briefing (recurring `agent` task; trivial after Phase 3)
- Weekly memory consolidation job (after Phases 4 + 6)
- Email integration (new credential surface; only on request)
