import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertTransition,
  isFeatureState,
  isStoppablePipelineState,
  type FeatureState,
} from "./state.js";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export type Feature = {
  id: number;
  name: string;
  state: FeatureState;
  discordMessageId: string | null;
  discordThreadId: string | null;
  answerMessageId: string | null;
  plannerAgentId: string | null;
  implementerAgentId: string | null;
  pendingQuestion: string | null;
  pendingAnswer: string | null;
  githubBranch: string | null;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeatureAttachment = {
  id: number;
  featureId: number;
  filename: string;
  mimeType: string;
  storedName: string;
  createdAt: string;
};

export type OpenFeature = Feature & { noteCount: number };

export type PipelineLock = {
  feature: Feature;
  lockedAt: string;
};

type FeatureRow = {
  id: number;
  name: string;
  state: string;
  discord_message_id: string | null;
  discord_thread_id: string | null;
  answer_message_id: string | null;
  planner_agent_id: string | null;
  implementer_agent_id: string | null;
  pending_question: string | null;
  pending_answer: string | null;
  github_branch: string | null;
  github_pr_number: number | bigint | null;
  github_pr_url: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function mapFeature(row: FeatureRow): Feature {
  if (!isFeatureState(row.state)) {
    throw new Error(`Corrupt feature state: ${row.state}`);
  }
  return {
    id: Number(row.id),
    name: row.name,
    state: row.state,
    discordMessageId: row.discord_message_id,
    discordThreadId: row.discord_thread_id,
    answerMessageId: row.answer_message_id,
    plannerAgentId: row.planner_agent_id,
    implementerAgentId: row.implementer_agent_id,
    pendingQuestion: row.pending_question,
    pendingAnswer: row.pending_answer,
    githubBranch: row.github_branch,
    githubPrNumber:
      row.github_pr_number === null || row.github_pr_number === undefined
        ? null
        : Number(row.github_pr_number),
    githubPrUrl: row.github_pr_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FeatureStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath, { timeout: 5000 });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createFeature(name: string, channelId: string): Feature {
    const trimmed = name.trim();
    if (trimmed === "") {
      throw new UserFacingError("Feature name cannot be empty.");
    }
    const existing = this.getFeatureByName(trimmed);
    if (existing) {
      throw new UserFacingError(`Feature "${trimmed}" already exists.`);
    }
    const createdAt = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO features (name, state, created_at, updated_at)
       VALUES (?, 'collecting', ?, ?)`,
    );
    const result = insert.run(trimmed, createdAt, createdAt);
    const id = Number(result.lastInsertRowid);
    this.db
      .prepare(
        `INSERT INTO channel_latest (channel_id, feature_id)
         VALUES (?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET feature_id = excluded.feature_id`,
      )
      .run(channelId, id);
    const feature = this.getFeatureById(id);
    if (!feature) {
      throw new Error("Failed to load feature after insert");
    }
    return feature;
  }

  getFeatureById(id: number): Feature | undefined {
    const row = this.db.prepare("SELECT * FROM features WHERE id = ?").get(id) as
      | FeatureRow
      | undefined;
    return row ? mapFeature(row) : undefined;
  }

  getFeatureByName(name: string): Feature | undefined {
    const row = this.db.prepare("SELECT * FROM features WHERE name = ?").get(name.trim()) as
      | FeatureRow
      | undefined;
    return row ? mapFeature(row) : undefined;
  }

  getLatestFeatureForChannel(channelId: string): Feature | undefined {
    const row = this.db
      .prepare(
        `SELECT f.* FROM channel_latest cl
         JOIN features f ON f.id = cl.feature_id
         WHERE cl.channel_id = ?`,
      )
      .get(channelId) as FeatureRow | undefined;
    return row ? mapFeature(row) : undefined;
  }

  addNote(featureId: number, text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") {
      throw new UserFacingError("Note text cannot be empty.");
    }
    const feature = this.getFeatureById(featureId);
    if (!feature) {
      throw new UserFacingError("Feature not found.");
    }
    const createdAt = nowIso();
    this.db
      .prepare("INSERT INTO notes (feature_id, text, created_at) VALUES (?, ?, ?)")
      .run(featureId, trimmed, createdAt);
    this.db.prepare("UPDATE features SET updated_at = ? WHERE id = ?").run(createdAt, featureId);
  }

  listNotes(featureId: number): string[] {
    const rows = this.db
      .prepare("SELECT text FROM notes WHERE feature_id = ? ORDER BY id ASC")
      .all(featureId) as Array<{ text: string }>;
    return rows.map((row) => row.text);
  }

  addAttachment(
    featureId: number,
    info: { filename: string; mimeType: string; storedName: string },
  ): FeatureAttachment {
    const feature = this.getFeatureById(featureId);
    if (!feature) {
      throw new UserFacingError("Feature not found.");
    }
    const storedName = info.storedName.trim();
    if (storedName === "" || storedName.includes("/") || storedName.includes("\\")) {
      throw new UserFacingError("Invalid attachment name.");
    }
    const filename = info.filename.trim() === "" ? storedName : info.filename.trim();
    const mimeType = info.mimeType.trim();
    if (mimeType === "") {
      throw new UserFacingError("Attachment mime type cannot be empty.");
    }
    const createdAt = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO attachments (feature_id, filename, mime_type, stored_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(featureId, filename, mimeType, storedName, createdAt);
    this.db.prepare("UPDATE features SET updated_at = ? WHERE id = ?").run(createdAt, featureId);
    return {
      id: Number(result.lastInsertRowid),
      featureId,
      filename,
      mimeType,
      storedName,
      createdAt,
    };
  }

  listAttachments(featureId: number): FeatureAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT id, feature_id, filename, mime_type, stored_name, created_at
         FROM attachments WHERE feature_id = ? ORDER BY id ASC`,
      )
      .all(featureId) as Array<{
      id: number | bigint;
      feature_id: number | bigint;
      filename: string;
      mime_type: string;
      stored_name: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: Number(row.id),
      featureId: Number(row.feature_id),
      filename: row.filename,
      mimeType: row.mime_type,
      storedName: row.stored_name,
      createdAt: row.created_at,
    }));
  }

  listAllFeatures(): Feature[] {
    const rows = this.db
      .prepare("SELECT * FROM features ORDER BY updated_at DESC")
      .all() as FeatureRow[];
    return rows.map(mapFeature);
  }

  listFeaturesAwaitingGithub(): Feature[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM features
         WHERE github_pr_number IS NOT NULL AND state != 'accepted'
         ORDER BY updated_at DESC`,
      )
      .all() as FeatureRow[];
    return rows.map(mapFeature);
  }

  getFeatureByPrNumber(prNumber: number): Feature | undefined {
    const row = this.db
      .prepare("SELECT * FROM features WHERE github_pr_number = ?")
      .get(prNumber) as FeatureRow | undefined;
    return row ? mapFeature(row) : undefined;
  }

  setGithubBranch(featureId: number, branch: string): Feature {
    this.requireFeature(featureId);
    this.db
      .prepare("UPDATE features SET github_branch = ?, updated_at = ? WHERE id = ?")
      .run(branch, nowIso(), featureId);
    return this.requireFeature(featureId);
  }

  setGithubPr(
    featureId: number,
    info: { branch: string; number: number; url: string },
  ): Feature {
    this.requireFeature(featureId);
    this.db
      .prepare(
        `UPDATE features
         SET github_branch = ?, github_pr_number = ?, github_pr_url = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(info.branch, info.number, info.url, nowIso(), featureId);
    return this.requireFeature(featureId);
  }

  listOpenFeatures(): OpenFeature[] {
    const rows = this.db
      .prepare(
        `SELECT f.*, COUNT(n.id) AS note_count
         FROM features f
         LEFT JOIN notes n ON n.feature_id = f.id
         WHERE f.state != 'accepted'
         GROUP BY f.id
         ORDER BY f.updated_at DESC`,
      )
      .all() as Array<FeatureRow & { note_count: number }>;
    return rows.map((row) => ({ ...mapFeature(row), noteCount: Number(row.note_count) }));
  }

  getPipelineLock(): PipelineLock | undefined {
    const row = this.db
      .prepare(
        `SELECT f.*, pl.locked_at
         FROM pipeline_lock pl
         JOIN features f ON f.id = pl.feature_id
         WHERE pl.id = 1`,
      )
      .get() as (FeatureRow & { locked_at: string }) | undefined;
    if (!row) {
      return undefined;
    }
    return { feature: mapFeature(row), lockedAt: row.locked_at };
  }

  /** Take the single pipeline lock and move a collecting feature into planning. */
  startPlanning(featureId: number): Feature {
    const feature = this.getFeatureById(featureId);
    if (!feature) {
      throw new UserFacingError("Feature not found.");
    }
    if (feature.state !== "collecting") {
      throw new UserFacingError(
        `Feature "${feature.name}" is ${feature.state}, not collecting.`,
      );
    }
    const lock = this.getPipelineLock();
    if (lock) {
      throw new UserFacingError(
        `Pipeline is busy with "${lock.feature.name}" (${lock.feature.state}).`,
      );
    }
    assertTransition(feature.state, "planning");
    const updatedAt = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO pipeline_lock (id, feature_id, locked_at) VALUES (1, ?, ?)")
        .run(featureId, updatedAt);
      this.db
        .prepare("UPDATE features SET state = 'planning', updated_at = ? WHERE id = ?")
        .run(updatedAt, featureId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    const planned = this.getFeatureById(featureId);
    if (!planned) {
      throw new Error("Failed to load feature after planning");
    }
    return planned;
  }

  transition(featureId: number, next: FeatureState): Feature {
    const feature = this.requireFeature(featureId);
    assertTransition(feature.state, next);
    this.db
      .prepare("UPDATE features SET state = ?, updated_at = ? WHERE id = ?")
      .run(next, nowIso(), featureId);
    return this.requireFeature(featureId);
  }

  releasePipelineLock(): void {
    this.db.exec("DELETE FROM pipeline_lock WHERE id = 1");
  }

  /**
   * Cancel in-flight pipeline work. No PR → collecting and release the lock.
   * With a PR → awaiting_review and keep the lock.
   */
  stopPipelineWork(): { feature: Feature; releasedLock: boolean } {
    const lock = this.getPipelineLock();
    if (!lock) {
      throw new UserFacingError("Nothing to stop. No active pipeline.");
    }
    if (!isStoppablePipelineState(lock.feature.state)) {
      throw new UserFacingError(
        `Nothing to stop. **${lock.feature.name}** is ${lock.feature.state}.`,
      );
    }
    this.clearPendingQuestion(lock.feature.id);
    const next: FeatureState = lock.feature.githubPrNumber === null ? "collecting" : "awaiting_review";
    assertTransition(lock.feature.state, next);
    const updatedAt = nowIso();
    this.db.exec("BEGIN");
    try {
      if (next === "collecting") {
        this.db
          .prepare(
            `UPDATE features
             SET state = ?, planner_agent_id = NULL, pending_question = NULL,
                 pending_answer = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(next, updatedAt, lock.feature.id);
        this.db.exec("DELETE FROM pipeline_lock WHERE id = 1");
      } else {
        this.db
          .prepare("UPDATE features SET state = ?, updated_at = ? WHERE id = ?")
          .run(next, updatedAt, lock.feature.id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      feature: this.requireFeature(lock.feature.id),
      releasedLock: next === "collecting",
    };
  }

  setDiscordIds(
    featureId: number,
    ids: { messageId?: string | null; threadId?: string | null },
  ): void {
    this.requireFeature(featureId);
    this.db
      .prepare(
        `UPDATE features
         SET discord_message_id = COALESCE(?, discord_message_id),
             discord_thread_id = COALESCE(?, discord_thread_id),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(ids.messageId ?? null, ids.threadId ?? null, nowIso(), featureId);
  }

  setPlannerAgentId(featureId: number, agentId: string): void {
    this.requireFeature(featureId);
    this.db
      .prepare("UPDATE features SET planner_agent_id = ?, updated_at = ? WHERE id = ?")
      .run(agentId, nowIso(), featureId);
  }

  setImplementerAgentId(featureId: number, agentId: string): void {
    this.requireFeature(featureId);
    this.db
      .prepare("UPDATE features SET implementer_agent_id = ?, updated_at = ? WHERE id = ?")
      .run(agentId, nowIso(), featureId);
  }

  setPendingQuestion(featureId: number, question: string): void {
    this.requireFeature(featureId);
    this.db
      .prepare(
        `UPDATE features
         SET pending_question = ?, pending_answer = NULL, answer_message_id = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(question, nowIso(), featureId);
  }

  clearPendingQuestion(featureId: number): void {
    this.requireFeature(featureId);
    this.db
      .prepare(
        `UPDATE features
         SET pending_question = NULL, pending_answer = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(nowIso(), featureId);
  }

  /**
   * Record the first answer for the current pending question.
   * Returns the feature when this interaction wins, otherwise undefined.
   */
  recordFirstAnswer(featureId: number, interactionId: string, text: string): Feature | undefined {
    const feature = this.getFeatureById(featureId);
    if (!feature || feature.pendingQuestion === null || feature.answerMessageId !== null) {
      return undefined;
    }
    const updatedAt = nowIso();
    const answer = text.trim() === "" ? "(empty answer)" : text.trim();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE features
           SET answer_message_id = ?, pending_answer = ?, updated_at = ?
           WHERE id = ? AND answer_message_id IS NULL AND pending_question IS NOT NULL`,
        )
        .run(interactionId, answer, updatedAt, feature.id);
      this.db
        .prepare("INSERT INTO notes (feature_id, text, created_at) VALUES (?, ?, ?)")
        .run(feature.id, answer, updatedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getFeatureById(feature.id);
  }

  recordAgentRunTokens(
    runId: string,
    agentId: string,
    totalTokens: number | undefined,
    durationMs?: number,
  ): void {
    const tokens =
      totalTokens !== undefined && Number.isFinite(totalTokens) && totalTokens >= 0
        ? Math.round(totalTokens)
        : undefined;
    const duration =
      durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
        ? Math.round(durationMs)
        : undefined;
    if (runId.trim() === "" || (tokens === undefined && duration === undefined)) {
      return;
    }
    const existing = this.db
      .prepare("SELECT run_id FROM agent_run_tokens WHERE run_id = ?")
      .get(runId) as { run_id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE agent_run_tokens
           SET agent_id = ?,
               total_tokens = COALESCE(?, total_tokens),
               duration_ms = COALESCE(?, duration_ms),
               recorded_at = ?
           WHERE run_id = ?`,
        )
        .run(agentId, tokens ?? null, duration ?? null, nowIso(), runId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO agent_run_tokens (run_id, agent_id, total_tokens, duration_ms, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, agentId, tokens ?? 0, duration ?? null, nowIso());
  }

  totalAgentTokens(): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(total_tokens), 0) AS total FROM agent_run_tokens").get() as {
      total: number | bigint;
    };
    return Number(row.total);
  }

  totalAgentDurationMs(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(duration_ms), 0) AS total FROM agent_run_tokens")
      .get() as { total: number | bigint };
    return Number(row.total);
  }

  countAcceptedFeatures(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM features WHERE state = 'accepted'")
      .get() as { total: number | bigint };
    return Number(row.total);
  }

  /** Remove a feature plus notes, attachments, and channel-latest pointers. Does not revert git. */
  deleteFeature(featureId: number): Feature {
    const feature = this.requireFeature(featureId);
    const lock = this.getPipelineLock();
    this.db.exec("BEGIN");
    try {
      if (lock?.feature.id === featureId) {
        this.db.exec("DELETE FROM pipeline_lock WHERE id = 1");
      }
      this.db.prepare("DELETE FROM attachments WHERE feature_id = ?").run(featureId);
      this.db.prepare("DELETE FROM notes WHERE feature_id = ?").run(featureId);
      this.db.prepare("DELETE FROM channel_latest WHERE feature_id = ?").run(featureId);
      this.db.prepare("DELETE FROM features WHERE id = ?").run(featureId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return feature;
  }

  private requireFeature(featureId: number): Feature {
    const feature = this.getFeatureById(featureId);
    if (!feature) {
      throw new UserFacingError("Feature not found.");
    }
    return feature;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        discord_message_id TEXT,
        discord_thread_id TEXT,
        answer_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id INTEGER NOT NULL REFERENCES features(id),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        feature_id INTEGER NOT NULL REFERENCES features(id),
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_latest (
        channel_id TEXT PRIMARY KEY,
        feature_id INTEGER NOT NULL REFERENCES features(id)
      );
      CREATE TABLE IF NOT EXISTS pipeline_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        feature_id INTEGER NOT NULL REFERENCES features(id),
        locked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_run_tokens (
        run_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        total_tokens INTEGER,
        duration_ms INTEGER,
        recorded_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("features", "planner_agent_id", "TEXT");
    this.ensureColumn("features", "implementer_agent_id", "TEXT");
    this.ensureColumn("features", "pending_question", "TEXT");
    this.ensureColumn("features", "pending_answer", "TEXT");
    this.ensureColumn("features", "github_branch", "TEXT");
    this.ensureColumn("features", "github_pr_number", "INTEGER");
    this.ensureColumn("features", "github_pr_url", "TEXT");
    this.ensureColumn("agent_run_tokens", "duration_ms", "INTEGER");
  }

  private ensureColumn(table: string, column: string, type: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((col) => col.name === column)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
