import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';

import '../storage/database.dart';
import 'self_extension_models.dart';

/// SQLite CRUD for `self_extensions`.
class SelfExtensionStore {
  SelfExtensionStore(this._db);

  final AppDatabase _db;

  SelfExtension create({
    required String createdBy,
    required String channelId,
    required String description,
    String? title,
  }) {
    final now = DateTime.now().toUtc().toIso8601String();
    _db.db.execute(
      'INSERT INTO self_extensions (created_at, updated_at, created_by, '
      'channel_id, description, title, status) '
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        now,
        now,
        createdBy,
        channelId,
        description,
        title,
        SelfExtensionStatus.planning,
      ],
    );
    return byId(_db.db.lastInsertRowId)!;
  }

  SelfExtension? byId(int id) {
    final rows = _db.db.select(
      'SELECT * FROM self_extensions WHERE id = ?',
      [id],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// The single open extension, if any (newest open wins).
  SelfExtension? openExtension() {
    final rows = _db.db.select(
      "SELECT * FROM self_extensions WHERE status IN "
      "('planning','awaiting_plan_approval','revising_plan',"
      "'implementing','awaiting_merge') "
      'ORDER BY id DESC LIMIT 1',
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  SelfExtension? awaitingPlanApprovalInChannel(String channelId) {
    final rows = _db.db.select(
      "SELECT * FROM self_extensions WHERE channel_id = ? AND "
      "status = 'awaiting_plan_approval' ORDER BY id DESC LIMIT 1",
      [channelId],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  List<SelfExtension> listOpen() {
    final rows = _db.db.select(
      "SELECT * FROM self_extensions WHERE status IN "
      "('planning','awaiting_plan_approval','revising_plan',"
      "'implementing','awaiting_merge') "
      'ORDER BY id ASC',
    );
    return [for (final row in rows) _fromRow(row)];
  }

  void update({
    required int id,
    String? status,
    String? planMessageId,
    String? cursorAgentId,
    String? cursorRunId,
    String? planMarkdown,
    String? planJson,
    String? revisionNotes,
    String? prUrl,
    String? targetVersion,
    String? error,
    int? approvalId,
    bool clearError = false,
    bool clearApprovalId = false,
  }) {
    final sets = <String>['updated_at = ?'];
    final args = <Object?>[DateTime.now().toUtc().toIso8601String()];

    void set(String column, Object? value) {
      sets.add('$column = ?');
      args.add(value);
    }

    if (status != null) set('status', status);
    if (planMessageId != null) set('plan_message_id', planMessageId);
    if (cursorAgentId != null) set('cursor_agent_id', cursorAgentId);
    if (cursorRunId != null) set('cursor_run_id', cursorRunId);
    if (planMarkdown != null) set('plan_markdown', planMarkdown);
    if (planJson != null) set('plan_json', planJson);
    if (revisionNotes != null) set('revision_notes', revisionNotes);
    if (prUrl != null) set('pr_url', prUrl);
    if (targetVersion != null) set('target_version', targetVersion);
    if (clearError) {
      set('error', null);
    } else if (error != null) {
      set('error', error);
    }
    if (clearApprovalId) {
      set('approval_id', null);
    } else if (approvalId != null) {
      set('approval_id', approvalId);
    }

    args.add(id);
    _db.db.execute(
      'UPDATE self_extensions SET ${sets.join(', ')} WHERE id = ?',
      args,
    );
  }

  SelfExtension _fromRow(Row row) {
    return SelfExtension(
      id: row['id'] as int,
      createdAt: DateTime.parse(row['created_at'] as String),
      updatedAt: DateTime.parse(row['updated_at'] as String),
      createdBy: row['created_by'] as String,
      channelId: row['channel_id'] as String,
      description: row['description'] as String,
      status: row['status'] as String,
      title: row['title'] as String?,
      planMessageId: row['plan_message_id'] as String?,
      cursorAgentId: row['cursor_agent_id'] as String?,
      cursorRunId: row['cursor_run_id'] as String?,
      planMarkdown: row['plan_markdown'] as String?,
      planJson: row['plan_json'] as String?,
      revisionNotes: row['revision_notes'] as String?,
      prUrl: row['pr_url'] as String?,
      targetVersion: row['target_version'] as String?,
      error: row['error'] as String?,
      approvalId: row['approval_id'] as int?,
    );
  }
}

/// Helper to encode plan meta for [SelfExtensionStore.update].
String encodePlanJson(Map<String, Object?> meta) => jsonEncode(meta);
