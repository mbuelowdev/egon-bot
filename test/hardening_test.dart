import 'dart:io';

import 'package:egon_bot/src/discord/gateway_watchdog.dart';
import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/storage/database.dart';
import 'package:egon_bot/src/storage/database_backup.dart';
import 'package:egon_bot/src/tools/builtin/review_audit_log_tool.dart';
import 'package:egon_bot/src/tools/builtin/web_search_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

final _messages = [OllamaChatMessage(role: 'user', content: 'hi')];

void main() {
  group('GatewayWatchdog', () {
    test('fires onSilence after silenceTimeout', () async {
      var now = DateTime.utc(2026, 8, 1, 12);
      var fired = false;
      final watchdog = GatewayWatchdog(
        silenceTimeout: const Duration(minutes: 10),
        checkInterval: const Duration(milliseconds: 20),
        clock: () => now,
        onSilence: () => fired = true,
      )..start();

      now = now.add(const Duration(minutes: 9));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(fired, isFalse);

      now = now.add(const Duration(minutes: 2));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(fired, isTrue);
      watchdog.stop();
    });

    test('touch resets the silence clock', () async {
      var now = DateTime.utc(2026, 8, 1, 12);
      var fired = false;
      final watchdog = GatewayWatchdog(
        silenceTimeout: const Duration(minutes: 10),
        checkInterval: const Duration(milliseconds: 20),
        clock: () => now,
        onSilence: () => fired = true,
      )..start();

      now = now.add(const Duration(minutes: 9));
      watchdog.touch();
      now = now.add(const Duration(minutes: 9));
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(fired, isFalse);
      watchdog.stop();
    });
  });

  group('LlmGate monitor-down notice', () {
    test('notifies once after threshold when monitor stays down', () async {
      final notices = <String>[];
      var now = DateTime.utc(2026, 8, 1, 12);
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..unreachable = true;
      final gate = LlmGate(
        ollama: ollama,
        monitor: monitor,
        utilityModel: 'small-model',
        busyThresholdPercent: 40,
        pollInterval: const Duration(milliseconds: 20),
        monitorDownNotifyAfter: const Duration(minutes: 15),
        onMonitorDownNotice: notices.add,
        clock: () => now,
      )..start();

      // Unreachable → free: big chat runs immediately.
      await gate
          .chat(
            tier: ModelTier.big,
            messages: _messages,
            originChannelId: '42',
          )
          .timeout(const Duration(seconds: 1));
      expect(ollama.chatCalls, 1);
      expect(notices, isEmpty);

      now = now.add(const Duration(minutes: 16));
      await gate.isGpuFree();
      expect(notices, ['monitor down, treating GPU as free']);
      expect(gate.monitorDownNotified, isTrue);

      // Still only once.
      now = now.add(const Duration(minutes: 20));
      await gate.isGpuFree();
      expect(notices, hasLength(1));

      gate.dispose();
    });
  });

  group('DatabaseBackup', () {
    test('rotates once per UTC day and restores from bak', () {
      final dir = Directory.systemTemp.createTempSync('egon-db-bak-');
      addTearDown(() {
        if (dir.existsSync()) dir.deleteSync(recursive: true);
      });

      final db = AppDatabase.open(dir.path);
      db.db.execute(
        "INSERT INTO tool_audit_log (at, tool, caller, channel, args_json, ok, duration_ms) "
        "VALUES ('2026-08-01T00:00:00.000Z', 'web_search', '1', '2', '{}', 1, 1)",
      );
      DatabaseBackup.maybeRotateDaily(db, dir.path);
      expect(File(DatabaseBackup.bakPath(dir.path)).existsSync(), isTrue);
      expect(
        File(DatabaseBackup.dateMarkerPath(dir.path)).readAsStringSync(),
        DateTime.now().toUtc().toIso8601String().substring(0, 10),
      );

      // Second call same day is a no-op for content (marker stays).
      final bakMtime =
          File(DatabaseBackup.bakPath(dir.path)).statSync().modified;
      DatabaseBackup.maybeRotateDaily(db, dir.path);
      expect(
        File(DatabaseBackup.bakPath(dir.path)).statSync().modified,
        bakMtime,
      );
      db.dispose();

      // Corrupt the live DB, then open should restore.
      File('${dir.path}/egon.db').writeAsBytesSync([0, 1, 2, 3, 4]);
      for (final suffix in ['-wal', '-shm']) {
        final f = File('${dir.path}/egon.db$suffix');
        if (f.existsSync()) f.deleteSync();
      }

      final restored = AppDatabase.open(dir.path);
      final rows = restored.db.select(
        "SELECT tool FROM tool_audit_log WHERE tool = 'web_search'",
      );
      expect(rows, isNotEmpty);
      expect(
        File(DatabaseBackup.restoredMarkerPath(dir.path)).existsSync(),
        isTrue,
      );
      final when = DatabaseBackup.takeRestoredMarker(dir.path);
      expect(when, isNotNull);
      restored.dispose();
    });
  });

  group('review_audit_log', () {
    test('summarizes today\'s calls for the owner', () async {
      final services = testServices(tools: [ReviewAuditLogTool()]);
      services.database.db.execute(
        'INSERT INTO tool_audit_log (at, tool, caller, channel, args_json, ok, duration_ms) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          DateTime.now().toUtc().toIso8601String(),
          'web_search',
          ownerId,
          '42',
          '{}',
          1,
          12,
        ],
      );
      services.database.db.execute(
        'INSERT INTO tool_audit_log (at, tool, caller, channel, args_json, ok, duration_ms) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          DateTime.now().toUtc().toIso8601String(),
          'fetch_url',
          ownerId,
          '42',
          '{}',
          0,
          3,
        ],
      );

      final result = await ReviewAuditLogTool().execute(
        contextFor(services, owner: true, isDm: true),
        {},
      );
      expect(result.isError, isFalse);
      expect(result.json['total_calls'], 2);
      final byTool = result.json['by_tool'] as List;
      expect(byTool.length, greaterThanOrEqualTo(2));
    });

    test('is personal (schemas hidden from non-owners)', () {
      final services = testServices(
        tools: [ReviewAuditLogTool(), WebSearchTool()],
      );
      final names = services.registry
          .schemasFor(contextFor(services, owner: false))
          .map((t) => t.name)
          .toSet();
      expect(names.contains('review_audit_log'), isFalse);
      expect(names.contains('web_search'), isTrue);
    });
  });
}
