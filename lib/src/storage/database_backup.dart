import 'dart:io';

import 'database.dart';

/// Daily SQLite backup + restore-on-corruption helpers (§17).
abstract final class DatabaseBackup {
  static const bakName = 'egon.db.bak';
  static const dateMarkerName = 'egon.db.bak.date';
  static const restoredMarkerName = '.db_restored_from_backup';

  static String stateDir(String dataDir) => '$dataDir/state';

  static String bakPath(String dataDir) => '${stateDir(dataDir)}/$bakName';

  static String dateMarkerPath(String dataDir) =>
      '${stateDir(dataDir)}/$dateMarkerName';

  static String restoredMarkerPath(String dataDir) =>
      '${stateDir(dataDir)}/$restoredMarkerName';

  /// Copies `$dataDir/egon.db` → `state/egon.db.bak` at most once per UTC day.
  static void maybeRotateDaily(AppDatabase database, String dataDir) {
    final state = Directory(stateDir(dataDir))..createSync(recursive: true);
    final today = _utcDay(DateTime.now().toUtc());
    final marker = File('${state.path}/$dateMarkerName');
    if (marker.existsSync() && marker.readAsStringSync().trim() == today) {
      return;
    }

    final dbFile = File('$dataDir/egon.db');
    if (!dbFile.existsSync()) return;

    try {
      database.db.execute('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (error) {
      stderr.writeln('DB backup checkpoint failed (continuing copy): $error');
    }

    final bak = File('${state.path}/$bakName');
    dbFile.copySync(bak.path);
    marker.writeAsStringSync(today);
    stdout.writeln('Rotated daily SQLite backup → ${bak.path}');
  }

  /// Restores [bakPath] over the live DB file. Returns true if restored.
  static bool restoreFromBackup(String dataDir) {
    final bak = File(bakPath(dataDir));
    if (!bak.existsSync()) return false;
    final live = File('$dataDir/egon.db');
    // Drop WAL/SHM companions so the restored main file is authoritative.
    for (final suffix in ['-wal', '-shm']) {
      final side = File('${live.path}$suffix');
      if (side.existsSync()) side.deleteSync();
    }
    Directory(stateDir(dataDir)).createSync(recursive: true);
    bak.copySync(live.path);
    File(restoredMarkerPath(dataDir)).writeAsStringSync(
      DateTime.now().toUtc().toIso8601String(),
    );
    stderr.writeln(
      'Restored SQLite from backup ${bak.path} after open/migrate failure.',
    );
    return true;
  }

  /// Consumes the restore marker (for owner notification). Null if absent.
  static String? takeRestoredMarker(String dataDir) {
    final marker = File(restoredMarkerPath(dataDir));
    if (!marker.existsSync()) return null;
    final when = marker.readAsStringSync().trim();
    marker.deleteSync();
    return when.isEmpty ? DateTime.now().toUtc().toIso8601String() : when;
  }

  static String _utcDay(DateTime utc) =>
      '${utc.year.toString().padLeft(4, '0')}-'
      '${utc.month.toString().padLeft(2, '0')}-'
      '${utc.day.toString().padLeft(2, '0')}';
}
