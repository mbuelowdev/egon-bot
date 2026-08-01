/// Append-only migration list. Never edit an entry after it shipped —
/// add a new one. `PRAGMA user_version` tracks the applied count.
const List<String> migrations = [
  // 1: user whitelist + tool audit trail (§16, §6.2)
  '''
  CREATE TABLE whitelisted_users (
    user_id   TEXT PRIMARY KEY,
    added_at  TEXT NOT NULL,
    added_by  TEXT NOT NULL,
    note      TEXT
  );
  CREATE TABLE tool_audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           TEXT NOT NULL,
    tool         TEXT NOT NULL,
    caller       TEXT NOT NULL,
    channel      TEXT NOT NULL,
    args_json    TEXT NOT NULL,
    ok           INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL
  );
  ''',

  // 2: approvals (§6.5) + memories / conversation log (§7)
  '''
  CREATE TABLE pending_approvals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    message_id    TEXT,
    requested_by  TEXT NOT NULL,
    tool_name     TEXT NOT NULL,
    args_json     TEXT NOT NULL,
    preview       TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    channel_id  TEXT,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL,
    tags        TEXT
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    tags,
    content='memories',
    content_rowid='id'
  );
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags)
    VALUES (new.id, new.content, coalesce(new.tags, ''));
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags)
    VALUES ('delete', old.id, old.content, coalesce(old.tags, ''));
  END;
  CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags)
    VALUES ('delete', old.id, old.content, coalesce(old.tags, ''));
    INSERT INTO memories_fts(rowid, content, tags)
    VALUES (new.id, new.content, coalesce(new.tags, ''));
  END;

  CREATE TABLE conversation_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    content     TEXT NOT NULL
  );
  CREATE INDEX conversation_log_channel_id
    ON conversation_log(channel_id, id);
  ''',

  // 3: scheduler (§8)
  '''
  CREATE TABLE scheduled_tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    kind          TEXT NOT NULL,
    payload       TEXT NOT NULL,
    state_json    TEXT,
    due_at        TEXT,
    recurrence    TEXT,
    timezone      TEXT NOT NULL DEFAULT 'Europe/Berlin',
    status        TEXT NOT NULL DEFAULT 'pending',
    last_run_at   TEXT,
    next_run_at   TEXT NOT NULL
  );
  CREATE INDEX idx_tasks_due ON scheduled_tasks(status, next_run_at);
  ''',

  // 4: long-running jobs (§9)
  '''
  CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT NOT NULL,
    created_by      TEXT NOT NULL,
    channel_id      TEXT NOT NULL,
    title           TEXT NOT NULL,
    instructions    TEXT NOT NULL,
    plan_json       TEXT,
    current_step    INTEGER,
    status          TEXT NOT NULL DEFAULT 'queued',
    question        TEXT,
    progress_log    TEXT,
    result          TEXT,
    priority        INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX idx_jobs_status ON jobs(status, priority DESC, id ASC);
  ''',

  // 5: post-boot notices for self-extension restarts (§6.4)
  '''
  CREATE TABLE pending_notices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message     TEXT NOT NULL,
    posted      INTEGER NOT NULL DEFAULT 0
  );
  ''',

  // 6: attachments + address book (§10, §14)
  '''
  CREATE TABLE files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    path        TEXT NOT NULL
  );
  CREATE INDEX idx_files_channel ON files(channel_id, id DESC);

  CREATE TABLE contacts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at       TEXT NOT NULL,
    name             TEXT NOT NULL,
    aliases          TEXT,
    discord_user_id  TEXT,
    notes            TEXT
  );
  ''',
];
