import 'package:sqlite3/sqlite3.dart';

import '../storage/database.dart';
import 'recurrence.dart';

/// Values stored in `scheduled_tasks.status`.
abstract final class TaskStatus {
  static const pending = 'pending';
  static const done = 'done';
  static const cancelled = 'cancelled';
  static const missed = 'missed';
}

/// Values stored in `scheduled_tasks.kind`.
abstract final class TaskKind {
  static const message = 'message';
  static const agent = 'agent';
  static const watch = 'watch';
}

/// One row from `scheduled_tasks` (ARCHITECTURE.md §8).
class ScheduledTask {
  ScheduledTask({
    required this.id,
    required this.createdAt,
    required this.createdBy,
    required this.channelId,
    required this.kind,
    required this.payload,
    required this.stateJson,
    required this.dueAt,
    required this.recurrence,
    required this.timezone,
    required this.status,
    required this.lastRunAt,
    required this.nextRunAt,
  });

  final int id;
  final DateTime createdAt;
  final String createdBy;
  final String channelId;
  final String kind;
  final String payload;
  final String? stateJson;
  final DateTime? dueAt;
  final String? recurrence;
  final String timezone;
  final String status;
  final DateTime? lastRunAt;
  final DateTime nextRunAt;

  bool get isRecurring => recurrence != null && recurrence!.isNotEmpty;
}

/// CRUD + due-query helpers for `scheduled_tasks`.
class TaskStore {
  TaskStore(this._db);

  final AppDatabase _db;

  ScheduledTask? byId(int id) {
    final rows = _db.db.select(
      'SELECT * FROM scheduled_tasks WHERE id = ?',
      [id],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  List<ScheduledTask> list({
    String? status,
    String? createdBy,
    int limit = 50,
  }) {
    final clauses = <String>[];
    final args = <Object?>[];
    if (status != null) {
      clauses.add('status = ?');
      args.add(status);
    }
    if (createdBy != null) {
      clauses.add('created_by = ?');
      args.add(createdBy);
    }
    final where = clauses.isEmpty ? '' : 'WHERE ${clauses.join(' AND ')}';
    args.add(limit);
    final rows = _db.db.select(
      'SELECT * FROM scheduled_tasks $where '
      'ORDER BY next_run_at ASC LIMIT ?',
      args,
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// Pending tasks whose [next_run_at] is at or before [now].
  List<ScheduledTask> dueAtOrBefore(DateTime now) {
    final rows = _db.db.select(
      "SELECT * FROM scheduled_tasks "
      "WHERE status = 'pending' AND next_run_at <= ? "
      'ORDER BY next_run_at ASC',
      [now.toUtc().toIso8601String()],
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// Creates a one-shot or recurring task. Validates cron / due_at.
  /// Throws [FormatException] / [ArgumentError] on bad input.
  ScheduledTask create({
    required String createdBy,
    required String channelId,
    required String kind,
    required String payload,
    required String timezone,
    DateTime? dueAt,
    String? recurrence,
    String? stateJson,
    DateTime? now,
  }) {
    if (payload.trim().isEmpty) {
      throw ArgumentError('payload must not be empty');
    }
    if (kind != TaskKind.message &&
        kind != TaskKind.agent &&
        kind != TaskKind.watch) {
      throw ArgumentError('kind must be message, agent, or watch');
    }

    final hasDue = dueAt != null;
    final hasCron = recurrence != null && recurrence.trim().isNotEmpty;
    if (hasDue == hasCron) {
      throw ArgumentError('Provide exactly one of due_at or recurrence');
    }

    final created = (now ?? DateTime.now()).toUtc();
    late final DateTime nextRun;
    String? cronStored;
    DateTime? dueStored;

    if (hasCron) {
      final cron = CronExpression.parse(recurrence.trim());
      cronStored = cron.source;
      nextRun = nextOccurrence(
        cron: cron,
        timezoneName: timezone,
        after: created,
      );
    } else {
      dueStored = dueAt!.toUtc();
      if (!dueStored.isAfter(created)) {
        throw ArgumentError('due_at must be in the future');
      }
      nextRun = dueStored;
    }

    _db.db.execute(
      'INSERT INTO scheduled_tasks (created_at, created_by, channel_id, kind, '
      'payload, state_json, due_at, recurrence, timezone, status, last_run_at, '
      'next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      [
        created.toIso8601String(),
        createdBy,
        channelId,
        kind,
        payload,
        stateJson,
        dueStored?.toIso8601String(),
        cronStored,
        timezone,
        TaskStatus.pending,
        nextRun.toIso8601String(),
      ],
    );
    return byId(_db.db.lastInsertRowId)!;
  }

  /// Soft-cancels a pending task. Returns false if missing or not pending.
  bool cancel(int id) {
    final task = byId(id);
    if (task == null || task.status != TaskStatus.pending) return false;
    _db.db.execute(
      "UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?",
      [id],
    );
    return true;
  }

  void markDone(int id, {required DateTime ranAt}) {
    _db.db.execute(
      "UPDATE scheduled_tasks SET status = 'done', last_run_at = ? WHERE id = ?",
      [ranAt.toUtc().toIso8601String(), id],
    );
  }

  void markMissed(int id) {
    _db.db.execute(
      "UPDATE scheduled_tasks SET status = 'missed' WHERE id = ?",
      [id],
    );
  }

  void updateAfterRun({
    required int id,
    required DateTime ranAt,
    required DateTime nextRunAt,
    String? stateJson,
  }) {
    _db.db.execute(
      'UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ?, '
      'state_json = COALESCE(?, state_json) WHERE id = ?',
      [
        ranAt.toUtc().toIso8601String(),
        nextRunAt.toUtc().toIso8601String(),
        stateJson,
        id,
      ],
    );
  }

  void deferNextRun(int id, DateTime nextRunAt) {
    _db.db.execute(
      'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
      [nextRunAt.toUtc().toIso8601String(), id],
    );
  }

  ScheduledTask _fromRow(Row row) => ScheduledTask(
        id: row['id'] as int,
        createdAt: DateTime.parse(row['created_at'] as String),
        createdBy: row['created_by'] as String,
        channelId: row['channel_id'] as String,
        kind: row['kind'] as String,
        payload: row['payload'] as String,
        stateJson: row['state_json'] as String?,
        dueAt: row['due_at'] == null
            ? null
            : DateTime.parse(row['due_at'] as String),
        recurrence: row['recurrence'] as String?,
        timezone: row['timezone'] as String,
        status: row['status'] as String,
        lastRunAt: row['last_run_at'] == null
            ? null
            : DateTime.parse(row['last_run_at'] as String),
        nextRunAt: DateTime.parse(row['next_run_at'] as String),
      );
}
