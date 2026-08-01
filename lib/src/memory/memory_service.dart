import 'package:sqlite3/sqlite3.dart';

import '../storage/database.dart';

/// One row from the `memories` table (§7).
class Memory {
  Memory({
    required this.id,
    required this.createdAt,
    required this.userId,
    required this.channelId,
    required this.content,
    required this.source,
    required this.tags,
  });

  final int id;
  final DateTime createdAt;
  final String userId;
  final String? channelId;
  final String content;
  final String source;
  final String? tags;
}

/// Persistent long-term memory with FTS5 retrieval (ARCHITECTURE.md §7).
class MemoryService {
  MemoryService(this._db);

  final AppDatabase _db;

  /// Stores a memory. Returns the new row id.
  int remember({
    required String userId,
    required String content,
    required String source,
    String? channelId,
    String? tags,
  }) {
    final trimmed = content.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('Memory content must not be empty.');
    }
    _db.db.execute(
      'INSERT INTO memories (created_at, user_id, channel_id, content, source, '
      'tags) VALUES (?, ?, ?, ?, ?, ?)',
      [
        DateTime.now().toUtc().toIso8601String(),
        userId,
        channelId,
        trimmed,
        source,
        tags,
      ],
    );
    return _db.db.lastInsertRowId;
  }

  /// FTS5 search, most recent matches first. Returns [] when [query] has no
  /// usable tokens.
  List<Memory> search(String query, {int limit = 5}) {
    final fts = buildFtsQuery(query);
    if (fts.isEmpty) return const [];

    final rows = _db.db.select(
      'SELECT m.id, m.created_at, m.user_id, m.channel_id, m.content, '
      'm.source, m.tags '
      'FROM memories_fts f '
      'JOIN memories m ON m.id = f.rowid '
      'WHERE memories_fts MATCH ? '
      'ORDER BY m.id DESC '
      'LIMIT ?',
      [fts, limit],
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// Deletes by id. Returns false when the id did not exist.
  bool forget(int id) {
    final existed =
        _db.db.select('SELECT 1 FROM memories WHERE id = ?', [id]).isNotEmpty;
    if (!existed) return false;
    _db.db.execute('DELETE FROM memories WHERE id = ?', [id]);
    return true;
  }

  Memory? byId(int id) {
    final rows = _db.db.select(
      'SELECT id, created_at, user_id, channel_id, content, source, tags '
      'FROM memories WHERE id = ?',
      [id],
    );
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  /// Newest-first page for `list_memories`.
  List<Memory> list({int limit = 20, int offset = 0}) {
    final rows = _db.db.select(
      'SELECT id, created_at, user_id, channel_id, content, source, tags '
      'FROM memories ORDER BY id DESC LIMIT ? OFFSET ?',
      [limit, offset],
    );
    return [for (final row in rows) _fromRow(row)];
  }

  /// R3: every accepted DM is stored as a memory.
  int captureDm({
    required String userId,
    required String channelId,
    required String content,
  }) {
    return remember(
      userId: userId,
      channelId: channelId,
      content: content,
      source: 'dm',
    );
  }

  /// FTS5 boolean operators — never treat these as search terms.
  static const _ftsStopWords = {
    'AND',
    'OR',
    'NOT',
    'NEAR',
  };

  /// Builds a safe FTS5 MATCH expression from free text. Returns empty when
  /// there are no tokens of length ≥ 2.
  static String buildFtsQuery(String text) {
    final tokens = RegExp(r'[A-Za-zÄÖÜäöüß0-9]{2,}')
        .allMatches(text)
        .map((m) => m.group(0)!)
        .where((t) => !_ftsStopWords.contains(t.toUpperCase()))
        .toSet()
        .take(12)
        .toList();
    if (tokens.isEmpty) return '';
    // Phrase-quote each token so punctuation / operators in the original
    // message cannot break the MATCH parser.
    return tokens.map((t) => '"$t"').join(' OR ');
  }

  Memory _fromRow(Row row) => Memory(
        id: row['id'] as int,
        createdAt: DateTime.parse(row['created_at'] as String),
        userId: row['user_id'] as String,
        channelId: row['channel_id'] as String?,
        content: row['content'] as String,
        source: row['source'] as String,
        tags: row['tags'] as String?,
      );
}
