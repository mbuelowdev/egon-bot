import '../llm/ollama_models.dart';
import '../memory/memory_service.dart';
import '../storage/database.dart';
import '../time/timestamps.dart';
import 'prompts.dart';

/// One remembered message in a channel's rolling history.
class ChannelMessage {
  ChannelMessage({
    required this.timestamp,
    required this.authorId,
    required this.authorName,
    required this.content,
  });

  final DateTime timestamp;
  final String authorId;
  final String authorName;
  final String content;
}

/// Persistent rolling per-channel history backed by `conversation_log` (§7).
class ChannelHistoryStore {
  ChannelHistoryStore(this._db);

  final AppDatabase _db;

  /// Rolling window kept in SQLite and injected into the prompt.
  static const maxMessagesPerChannel = 25;

  void add(String channelId, ChannelMessage message) {
    _db.db.execute(
      'INSERT INTO conversation_log (channel_id, author_id, author_name, '
      'created_at, content) VALUES (?, ?, ?, ?, ?)',
      [
        channelId,
        message.authorId,
        message.authorName,
        message.timestamp.toUtc().toIso8601String(),
        message.content,
      ],
    );
    _prune(channelId);
  }

  List<ChannelMessage> recent(
    String channelId, {
    int limit = maxMessagesPerChannel,
  }) {
    final rows = _db.db.select(
      'SELECT author_id, author_name, created_at, content '
      'FROM conversation_log WHERE channel_id = ? '
      'ORDER BY id DESC LIMIT ?',
      [channelId, limit],
    );
    return [
      for (final row in rows.reversed)
        ChannelMessage(
          timestamp: DateTime.parse(row['created_at'] as String),
          authorId: row['author_id'] as String,
          authorName: row['author_name'] as String,
          content: row['content'] as String,
        ),
    ];
  }

  void _prune(String channelId) {
    _db.db.execute(
      'DELETE FROM conversation_log WHERE channel_id = ? AND id NOT IN ('
      '  SELECT id FROM conversation_log WHERE channel_id = ? '
      '  ORDER BY id DESC LIMIT ?'
      ')',
      [channelId, channelId, maxMessagesPerChannel],
    );
  }
}

const _truncationMarker = ' …[truncated]';

String _truncate(String content, int maxChars) {
  if (content.length <= maxChars) return content;
  if (maxChars <= _truncationMarker.length) {
    return content.substring(0, maxChars);
  }
  return content.substring(0, maxChars - _truncationMarker.length) +
      _truncationMarker;
}

/// Drops the just-logged current turn so it is only sent as the final user
/// message, not duplicated in prior history.
List<ChannelMessage> priorHistoryExcludingCurrent(
  List<ChannelMessage> history, {
  required String authorId,
  required String content,
}) {
  if (history.isEmpty) return history;
  final last = history.last;
  if (last.authorId == authorId && last.content == content) {
    return history.sublist(0, history.length - 1);
  }
  return history;
}

/// Turns rolling channel history into real chat turns (bot → assistant,
/// everyone else → user) so follow-ups keep conversational continuity.
List<OllamaChatMessage> historyAsChatMessages(
  List<ChannelMessage> history, {
  required Timestamps timestamps,
  required String botAuthorName,
  int maxMessageChars = 500,
}) {
  return [
    for (final m in history)
      if (m.authorName == botAuthorName)
        OllamaChatMessage(
          role: 'assistant',
          content: _truncate(m.content, maxMessageChars),
        )
      else
        OllamaChatMessage(
          role: 'user',
          content: buildUserMessage(
            localTimestamp: timestamps.format(m.timestamp),
            authorName: m.authorName,
            authorId: m.authorId,
            content: _truncate(m.content, maxMessageChars),
          ),
        ),
  ];
}

/// Renders history entries as readable prompt lines, oldest first.
String renderHistoryLines(
  List<ChannelMessage> history, {
  required Timestamps timestamps,
  int maxMessageChars = 500,
}) {
  if (history.isEmpty) return '(no messages yet)';
  return history
      .map(
        (m) => '- [${timestamps.format(m.timestamp)}] "${m.authorName}" '
            '(id=${m.authorId}) said: '
            '${_truncate(m.content, maxMessageChars)}',
      )
      .join('\n');
}

/// Renders automatic FTS hits for the system prompt (§7).
String renderMemoryLines(List<Memory> memories) {
  if (memories.isEmpty) return '(nothing relevant)';
  return memories
      .map(
        (m) => '- [#${m.id}, ${m.createdAt.toUtc().toIso8601String()}, '
            '${m.source}] ${_truncate(m.content, 300)}',
      )
      .join('\n');
}

/// Renders recent stored files for "this document" resolution (§10).
String renderRecentFilesLines(
  List<({int id, String name, String mime, DateTime createdAt})> files,
) {
  if (files.isEmpty) return '(no recent attachments)';
  return files
      .map(
        (f) => '- #${f.id} "${f.name}" (${f.mime}) '
            '${f.createdAt.toUtc().toIso8601String()}',
      )
      .join('\n');
}
