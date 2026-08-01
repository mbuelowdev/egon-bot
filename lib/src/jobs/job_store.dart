import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import '../storage/database.dart';
import 'job_models.dart';

/// CRUD helpers for the `jobs` table (§9).
class JobStore {
  JobStore(this._db);

  final AppDatabase _db;

  Job? byId(int id) {
    final rows = _db.db.select('SELECT * FROM jobs WHERE id = ?', [id]);
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  List<Job> list({
    Set<String>? statuses,
    String? createdBy,
    String? channelId,
    int limit = 50,
  }) {
    final clauses = <String>[];
    final args = <Object?>[];
    if (statuses != null && statuses.isNotEmpty) {
      final placeholders = List.filled(statuses.length, '?').join(', ');
      clauses.add('status IN ($placeholders)');
      args.addAll(statuses);
    }
    if (createdBy != null) {
      clauses.add('created_by = ?');
      args.add(createdBy);
    }
    if (channelId != null) {
      clauses.add('channel_id = ?');
      args.add(channelId);
    }
    final where = clauses.isEmpty ? '' : 'WHERE ${clauses.join(' AND ')}';
    args.add(limit);
    final rows = _db.db.select(
      'SELECT * FROM jobs $where '
      'ORDER BY priority DESC, id ASC LIMIT ?',
      args,
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// Currently planning/running job, if any (at most one active).
  Job? activeJob() {
    final rows = _db.db.select(
      "SELECT * FROM jobs WHERE status IN ('planning', 'running') "
      'ORDER BY id ASC LIMIT 1',
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// Next queued job (highest priority, then oldest id).
  Job? nextQueued() {
    final rows = _db.db.select(
      "SELECT * FROM jobs WHERE status = 'queued' "
      'ORDER BY priority DESC, id ASC LIMIT 1',
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// Atomically moves a queued job to [nextStatus]. Returns null if another
  /// worker already claimed it.
  Job? claimQueued(int id, {String nextStatus = JobStatus.planning}) {
    final at = DateTime.now().toUtc().toIso8601String();
    _db.db.execute(
      'UPDATE jobs SET status = ?, updated_at = ? '
      "WHERE id = ? AND status = 'queued'",
      [nextStatus, at, id],
    );
    final changes = _db.db.select('SELECT changes() AS c').first['c'] as int;
    if (changes == 0) return null;
    return byId(id);
  }

  Job? waitingInChannel(String channelId) {
    final rows = _db.db.select(
      "SELECT * FROM jobs WHERE status = 'waiting_user' AND channel_id = ? "
      'ORDER BY id ASC LIMIT 1',
      [channelId],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  Job? activeInChannel(String channelId) {
    final rows = _db.db.select(
      "SELECT * FROM jobs WHERE status IN ('planning', 'running') "
      'AND channel_id = ? ORDER BY id ASC LIMIT 1',
      [channelId],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  Job create({
    required String createdBy,
    required String channelId,
    required String title,
    required String instructions,
    DateTime? now,
  }) {
    final at = (now ?? DateTime.now()).toUtc();
    _db.db.execute(
      'INSERT INTO jobs (created_at, created_by, channel_id, title, '
      'instructions, plan_json, current_step, status, question, progress_log, '
      'result, priority, updated_at) '
      "VALUES (?, ?, ?, ?, ?, NULL, NULL, 'queued', NULL, NULL, NULL, 0, ?)",
      [
        at.toIso8601String(),
        createdBy,
        channelId,
        title,
        instructions,
        at.toIso8601String(),
      ],
    );
    return byId(_db.db.lastInsertRowId)!;
  }

  void setStatus(int id, String status, {DateTime? now}) {
    final at = (now ?? DateTime.now()).toUtc().toIso8601String();
    _db.db.execute(
      'UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?',
      [status, at, id],
    );
  }

  void savePlanProgress(
    int id, {
    required List<JobStep> plan,
    required int? currentStep,
    required String status,
    String? question,
    String? appendLog,
    String? result,
    String? title,
    int? priority,
    DateTime? now,
  }) {
    final existing = byId(id);
    final log = _mergeLog(existing?.progressLog, appendLog);
    final at = (now ?? DateTime.now()).toUtc().toIso8601String();
    _db.db.execute(
      'UPDATE jobs SET plan_json = ?, current_step = ?, status = ?, '
      'question = ?, progress_log = ?, result = COALESCE(?, result), '
      'title = COALESCE(?, title), '
      'priority = COALESCE(?, priority), updated_at = ? WHERE id = ?',
      [
        jsonEncode([for (final s in plan) s.toJson()]),
        currentStep,
        status,
        question,
        log,
        result,
        title,
        priority,
        at,
        id,
      ],
    );
  }

  void appendLog(int id, String note, {DateTime? now}) {
    final existing = byId(id);
    if (existing == null) return;
    final at = (now ?? DateTime.now()).toUtc().toIso8601String();
    _db.db.execute(
      'UPDATE jobs SET progress_log = ?, updated_at = ? WHERE id = ?',
      [_mergeLog(existing.progressLog, note), at, id],
    );
  }

  /// Re-queue a waiting job at the front of the FIFO.
  void requeueAtFront(int id, {DateTime? now}) {
    final rows = _db.db.select('SELECT MAX(priority) AS m FROM jobs');
    final maxPriority = (rows.first['m'] as int?) ?? 0;
    final at = (now ?? DateTime.now()).toUtc().toIso8601String();
    _db.db.execute(
      "UPDATE jobs SET status = 'queued', question = NULL, "
      'priority = ?, updated_at = ? WHERE id = ?',
      [maxPriority + 1, at, id],
    );
  }

  String? _mergeLog(String? existing, String? note) {
    if (note == null || note.isEmpty) return existing;
    final stamp = DateTime.now().toUtc().toIso8601String();
    final line = '[$stamp] $note';
    if (existing == null || existing.isEmpty) return line;
    return '$existing\n$line';
  }

  Job _fromRow(Row row) => Job(
        id: row['id'] as int,
        createdAt: DateTime.parse(row['created_at'] as String),
        createdBy: row['created_by'] as String,
        channelId: row['channel_id'] as String,
        title: row['title'] as String,
        instructions: row['instructions'] as String,
        plan: Job.decodePlan(row['plan_json'] as String?),
        currentStep: row['current_step'] as int?,
        status: row['status'] as String,
        question: row['question'] as String?,
        progressLog: row['progress_log'] as String?,
        result: row['result'] as String?,
        priority: row['priority'] as int? ?? 0,
        updatedAt: DateTime.parse(row['updated_at'] as String),
      );
}
