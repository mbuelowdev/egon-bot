import 'dart:io';

import 'package:sqlite3/sqlite3.dart';

import 'database_backup.dart';
import 'migrations.dart';

/// Wrapper around the SQLite handle at `$DATA_DIR/egon.db`.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  /// Opens `$dataDir/egon.db`, runs integrity check + migrations.
  ///
  /// On failure, restores `state/egon.db.bak` once (§17) and retries.
  factory AppDatabase.open(String dataDir) {
    Directory(dataDir).createSync(recursive: true);
    Directory(DatabaseBackup.stateDir(dataDir)).createSync(recursive: true);
    try {
      return _openPath('$dataDir/egon.db');
    } catch (error, stackTrace) {
      stderr.writeln('SQLite open/migrate failed: $error');
      stderr.writeln(stackTrace);
      if (!DatabaseBackup.restoreFromBackup(dataDir)) {
        rethrow;
      }
      return _openPath('$dataDir/egon.db');
    }
  }

  /// In-memory database for tests.
  factory AppDatabase.inMemory() {
    final db = sqlite3.openInMemory();
    _migrate(db);
    return AppDatabase._(db);
  }

  /// Opens an on-disk DB without restore (tests).
  factory AppDatabase.openFile(String path) => _openPath(path);

  static AppDatabase _openPath(String path) {
    final db = sqlite3.open(path);
    try {
      db.execute('PRAGMA journal_mode = WAL;');
      final check = db.select('PRAGMA integrity_check;');
      final result =
          check.isEmpty ? 'fail' : check.first.columnAt(0).toString();
      if (result != 'ok') {
        db.dispose();
        throw StateError('SQLite integrity_check failed: $result');
      }
      _migrate(db);
      return AppDatabase._(db);
    } catch (_) {
      db.dispose();
      rethrow;
    }
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
