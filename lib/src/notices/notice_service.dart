import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../config.dart';
import '../discord/discord_actions.dart';
import '../storage/database.dart';

/// Persists chat notices across the exit(42) restart boundary (§6.4).
class NoticeService {
  NoticeService({required AppDatabase database, required this.config})
      : _db = database;

  final AppDatabase _db;
  final Config config;

  void enqueue({required String channelId, required String message}) {
    _db.db.execute(
      'INSERT INTO pending_notices (created_at, channel_id, message, posted) '
      'VALUES (?, ?, ?, 0)',
      [DateTime.now().toUtc().toIso8601String(), channelId, message],
    );
  }

  /// Posts any unsent notices and marks them posted. Also surfaces a
  /// supervisor quarantine marker if present.
  Future<void> flush(NyxxGateway client) async {
    await _flushQuarantineMarker(client);
    final rows = _db.db.select(
      'SELECT id, channel_id, message FROM pending_notices '
      'WHERE posted = 0 ORDER BY id ASC',
    );
    for (final row in rows) {
      final id = row['id'] as int;
      final channelId = row['channel_id'] as String;
      final message = row['message'] as String;
      try {
        final channel =
            client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
        await sendLongMessage(channel, message);
        _db.db.execute(
          'UPDATE pending_notices SET posted = 1 WHERE id = ?',
          [id],
        );
      } catch (error) {
        stderr.writeln('Failed to post pending notice #$id: $error');
      }
    }
  }

  Future<void> _flushQuarantineMarker(NyxxGateway client) async {
    final marker = File('${config.dataDir}/tools/quarantine/.last_quarantined');
    if (!marker.existsSync()) return;
    final toolName = marker.readAsStringSync().trim();
    marker.deleteSync();
    if (toolName.isEmpty) return;

    final text = 'Tool `$toolName` was quarantined after causing crashes. '
        'It lives in `${config.dataDir}/tools/quarantine/` — fix or delete it '
        'before moving it back.';
    try {
      final dm = await client.users.createDm(
        Snowflake.parse(config.ownerUserId),
      );
      await sendLongMessage(dm, text);
    } catch (error) {
      stderr.writeln('Failed to DM quarantine notice: $error');
      // Fall back to a pending notice in the DB without a channel — skip.
    }
  }
}
