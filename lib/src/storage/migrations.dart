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
];
