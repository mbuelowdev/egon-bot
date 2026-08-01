import '../storage/database.dart';

/// Persistent user whitelist (§16). The owner is implicitly whitelisted.
class WhitelistService {
  WhitelistService({required AppDatabase database, required this.ownerUserId})
      : _db = database;

  final AppDatabase _db;
  final String ownerUserId;

  bool isAllowed(String userId) {
    if (userId == ownerUserId) return true;
    final rows = _db.db.select(
      'SELECT 1 FROM whitelisted_users WHERE user_id = ?',
      [userId],
    );
    return rows.isNotEmpty;
  }

  /// Returns false if the user was already whitelisted.
  bool add(String userId, {required String addedBy, String? note}) {
    if (isAllowed(userId)) return false;
    _db.db.execute(
      'INSERT INTO whitelisted_users (user_id, added_at, added_by, note) '
      'VALUES (?, ?, ?, ?)',
      [userId, DateTime.now().toUtc().toIso8601String(), addedBy, note],
    );
    return true;
  }

  /// Returns false if the user was not whitelisted.
  bool remove(String userId) {
    final existed = _db.db.select(
        'SELECT 1 FROM whitelisted_users WHERE user_id = ?',
        [userId]).isNotEmpty;
    _db.db.execute('DELETE FROM whitelisted_users WHERE user_id = ?', [
      userId,
    ]);
    return existed;
  }

  List<Map<String, Object?>> list() {
    final rows = _db.db.select(
      'SELECT user_id, added_at, note FROM whitelisted_users ORDER BY added_at',
    );
    return [
      for (final row in rows)
        {
          'user_id': row['user_id'],
          'added_at': row['added_at'],
          'note': row['note'],
        },
    ];
  }
}
