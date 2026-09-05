# Discord communication notes (egon-bot)

Notes extracted from the previous Dart/nyxx implementation before the app was wiped.
Use this when recreating the bot. Library was **nyxx ^6**.

---

## Stack and config

| Item | Value / behavior |
|------|------------------|
| Client | `Nyxx.connectGateway(token, intents, options: …)` |
| Plugins | `logging`, `cliIntegration` |
| Intents | `GatewayIntents.allUnprivileged \| GatewayIntents.messageContent` |
| Env | `DISCORD_BOT_TOKEN` (required), `OWNER_USER_ID` (required), `ALLOWED_CHANNEL_IDS` (comma-separated guild channel ids; empty = no guild channels) |

**Message Content Intent** is privileged: enable it in the Discord developer portal or guild messages without a mention arrive with empty content.

DMs are always in scope regardless of `ALLOWED_CHANNEL_IDS`.

---

## Connection lifecycle

### Reconnect loop (`bin/main.dart`)

Infinite loop around `Nyxx.connectGateway`:

1. Connect with the intents above.
2. Log bot user id; apply boot presence.
3. Hand off to the message router (`await router.run(client)`), which consumes `onMessageCreate` until the stream ends.
4. On stream end or thrown error: reconnect.
5. Timing:
   - After a connection that had previously succeeded, first retry after **60 seconds**.
   - If that reconnect fails again: wait **5 minutes**, then allow the early (60s) retry again.

nyxx also resumes transient gateway drops internally; this outer loop covers hard failures / stream end.

### Gateway watchdog

- Record timestamp of last activity (`touch`).
- Touch on every gateway `EventReceived` (subscribe to `client.gateway.messages`) and on each `onMessageCreate`.
- Periodic check (~30s): if silence exceeds **10 minutes**, log and `exit(1)` so an outer process (Docker / supervisor) restarts.
- Purpose: catch zombie connections that neither error nor deliver events.

### Boot presence

- Status: online, not AFK.
- Optional custom activity: `ActivityType.custom`, `name: 'Custom Status'`, `state: 'v{version}'`.
- Version source: `deployment.json` → `version`, else `pubspec.yaml` → `version`.
- Presence update is best-effort: failures are logged; the session continues.

---

## Message routing

Listen: `await for (final event in client.onMessageCreate)`.

### Filter pipeline

```
MessageCreate
  → empty content AND no attachments? → ignore
  → guild message AND channel not in ALLOWED_CHANNEL_IDS? → ignore
  → author is this bot? → ignore
       (outbound sends already logged; skip gateway echo)
  → addressed?
       addressed = DM OR content mentions bot (<@id> / <@!id>)
                   OR owner “job context” in that channel
                   (waiting/active job or self-extension awaiting approval)
  → if not addressed: append to short-term channel history (text + attachment
       filename/URL refs only — no download) → stop
  → if addressed but author not owner/whitelist: log + ignore
  → if addressed and allowed:
       download attachments (if any), normalize mentions, optionally
       transcribe voice, enqueue per-channel turn → agent/handler
```

### Guild vs DM

- **Guild:** only whitelisted channels; normally respond only when mentioned (or owner job context).
- **DM:** always addressed; previously also auto-captured into long-term memory.

### Mentions

Bot is mentioned when content contains `<@{botUserId}>` or `<@!{botUserId}>`.

### Author display name

Resolve in order: guild member nick → user `globalName` → `username` → snowflake id string.

### Per-channel turn queue

Serialize handler turns per `channelId` so a second mention while the first turn is still running does not overlap (avoids duplicate tool side-effects). Track `isBusy(channelId)` for “status/cancel while busy” short-circuits.

---

## Mentions for prompts / history

Before storing or sending text to an LLM:

- Bot mention tokens → plain `@Egon` (or configured bot label).
- Other mentioned users → `@Name (<@id>)` where `Name` is global name else username.

**Ping rule:** Discord only pings on the raw token `<@snowflake>`. Plain `@Name` does not ping. When the bot must ping someone in an outbound message (e.g. reminder payload), copy `<@id>` literally. In confirmation chatter, prefer the human-readable name without the token.

---

## Sending messages

### Text (2000-char limit)

- Discord limit: **2000** characters per message.
- Split long text preferring last newline before the limit, else last space, else hard cut.
- Send each chunk: `channel.sendMessage(MessageBuilder(content: chunk))`.

### DM a user

```
final dm = await client.users.createDm(Snowflake.parse(userId));
await sendLongMessage(dm, text);
```

Constraint: bots can only DM users who share a guild with the bot.

### Owner notify

Same as DM using `OWNER_USER_ID`. Mentions in channel text: `<@{ownerUserId}>`.

### Attachments out

```
MessageBuilder(
  content: optionalCaption,
  attachments: [
    AttachmentBuilder(data: bytes, fileName: name),
  ],
)
```

### Images / WebP

Discord message attachments preview JPEG/PNG/GIF reliably; **WebP often does not** render as an inline image. Before posting:

- Detect WebP via mime `image/webp`, `.webp` extension, or RIFF….WEBP magic.
- Convert to PNG (previously via `ffmpeg`) and upload as `image/png`.

### Edit / fetch

```
final channel = client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
final message = await channel.messages.fetch(Snowflake.parse(messageId));
await message.update(MessageUpdateBuilder(content: …, components: …));
```

---

## Buttons / component interactions (approvals)

Used for owner approve/reject flows in-channel.

### Post buttons

```
MessageBuilder(
  content: header,  // often mentions owner + requester
  components: [
    ActionRowBuilder(components: [
      ButtonBuilder.success(label: 'Approve', customId: 'egon:approve:$id'),
      ButtonBuilder.danger(label: 'Reject', customId: 'egon:reject:$id'),
    ]),
  ],
  // optional AttachmentBuilder for long preview text files
)
```

Historical `customId` prefixes:

| Prefix | Meaning |
|--------|---------|
| `egon:approve:` / `egon:reject:` | Tool / action approval |
| `egon:ext-approve:` / `egon:ext-reject:` | Self-extension plan approval |
| `egon:done:…` | Disabled placeholders after decision |

Long previews: truncate inline (~budget under 2000), attach full text as `preview-$id.txt` when needed.

### Listen

`client.onMessageComponentInteraction` → read `interaction.data.customId`, parse id after prefix, check actor is owner, apply decision.

Acknowledge:

- Forbidden actor: `interaction.respond(MessageBuilder(content: …, flags: MessageFlags.ephemeral))`
- Handled: `interaction.acknowledge(updateMessage: true)` (no visible follow-up; message already edited)
- Then disable buttons via `MessageUpdateBuilder` with same labels but `isDisabled: true` and inert `customId`s

---

## Guild message search

REST (via nyxx HTTP, not a high-level helper):

`GET /guilds/{guild.id}/messages/search`

Built with `HttpRoute` parts `guilds` / `messages` / `search`, executed as `BasicRequest` through `client.httpHandler.execute`.

### Query parameters

| Param | Notes |
|-------|--------|
| `content` | Keyword string |
| `channel_id` | Array |
| `author_id` | Array |
| `mentions` | Array |
| `has` | Array (Discord “has:” filters) |
| `min_id` / `max_id` | Snowflake bounds |
| `sort_by` / `sort_order` | Optional |
| `offset` / `limit` | Pagination (`limit` often 25) |
| `include_nsfw` | bool |

Scalars go in `queryParameters`; list params in `arrayQueryParameters`.

### Snowflake from time

Discord epoch ms: `1420070400000` (2015-01-01 UTC).

Lowest snowflake at-or-after instant:

`(utcMs - discordEpochMs) << 22` (floor at `0`).

### Index not ready

HTTP **202** or body `code == 110000` → guild search index not ready. Retry using `retry_after` (seconds) a few times, then return indexing state to the caller.

### Response shape

- `total_results`
- `messages`: list of groups; each group is a list of message objects. Prefer the item with `"hit": true`, else first map in the group.
- Jump URL: `https://discord.com/channels/{guildId}/{channelId}/{messageId}`
- Author display: `global_name` else `username`

### Resolve guild for a channel

```
final channel = await client.channels.get(Snowflake.parse(channelId));
// must be GuildChannel → channel.guildId
```

Search only works in guilds, not DMs.

---

## Inbound media (historical)

| Case | Behavior |
|------|----------|
| Not addressed | Log `filename (cdnUrl)` into history only; never download into storage |
| Addressed | Download each attachment (URL from `attachment.url`) with size cap (`MAX_ATTACHMENT_MB`, default 25) |
| Voice message | `message.flags.isAVoiceMessage`; audio was transcribed (ffmpeg + whisper.cpp) and content became `(voice message) {transcript}` |
| Other attachments | Append `(attached: name (url), …)` to content for the handler |

Too-large attachments: reply with an error and abort the turn.

---

## Remake checklist

1. Create Discord application + bot; copy token.
2. Enable **Message Content Intent** (and any other intents you need).
3. Invite bot to the guild with send/read/attach/use-app-commands permissions as needed.
4. Set `DISCORD_BOT_TOKEN`, `OWNER_USER_ID`, `ALLOWED_CHANNEL_IDS`.
5. Reimplement: connect + reconnect + watchdog, presence, routing filters, 2000-char split send, optional DM/owner notify, optional buttons, optional guild search, WebP→PNG before image upload.
6. Remember DM constraint: shared guild required.

---

## What was not Discord transport

LLM, tools, SQLite, scheduler, jobs, Obsidian, calendar, contacts, whitelist DB, etc. were application logic layered *on top* of the patterns above. They are intentionally omitted here; only Discord I/O behavior is preserved.
