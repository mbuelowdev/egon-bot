import 'dart:io';

import 'package:sqlite3/sqlite3.dart';

import 'migrations.dart';

/// Wrapper around the SQLite handle at `$DATA_DIR/egon.db`.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  factory AppDatabase.open(String dataDir) {
    Directory(dataDir).createSync(recursive: true);
    final db = sqlite3.open('$dataDir/egon.db');
    db.execute('PRAGMA journal_mode = WAL;');
    _migrate(db);
    return AppDatabase._(db);
  }

  /// In-memory database for tests.
  factory AppDatabase.inMemory() {
    final db = sqlite3.openInMemory();
    _migrate(db);
    return AppDatabase._(db);
  }

  static void _migrate(Database db) {
    final applied = db.select('PRAGMA user_version;').first.columnAt(0) as int;
    for (var i = applied; i < migrations.length; i++) {
      db.execute('BEGIN;');
      try {
        db.execute(migrations[i]);
        db.execute('PRAGMA user_version = ${i + 1};');
        db.execute('COMMIT;');
      } catch (_) {
        db.execute('ROLLBACK;');
        rethrow;
      }
    }
  }

  void dispose() => db.dispose();
}
