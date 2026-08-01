import 'package:timezone/timezone.dart';

import '../../time/timestamps.dart';
import '../tool.dart';

/// Owner-only daily activity report from `tool_audit_log` (§18 extra 2).
class ReviewAuditLogTool extends Tool {
  @override
  String get name => 'review_audit_log';

  @override
  String get description =>
      'Summarizes tool invocations from the audit log for a calendar day in '
      'BOT_TIMEZONE (default: today). Use when Michael asks "what did you do '
      'today?" or wants a daily activity report. Returns counts per tool plus '
      'a chronological list (capped).';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'day': {
            'type': 'string',
            'description':
                'Optional YYYY-MM-DD in BOT_TIMEZONE. Defaults to today.',
          },
          'limit': {
            'type': 'integer',
            'description': 'Max event rows to return (default 50, max 200).',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final timestamps = context.services.timestamps;
    final dayRaw = (args['day'] as String?)?.trim();
    final TZDateTime dayStart;
    try {
      dayStart = _dayStart(timestamps, dayRaw);
    } on FormatException catch (error) {
      return ToolResult.error(error.message);
    }
    final dayEnd = dayStart.add(const Duration(days: 1));
    final startUtc = dayStart.toUtc().toIso8601String();
    final endUtc = dayEnd.toUtc().toIso8601String();

    var limit = 50;
    final limitArg = args['limit'];
    if (limitArg is int) {
      limit = limitArg;
    } else if (limitArg != null) {
      limit = int.tryParse(limitArg.toString()) ?? 50;
    }
    if (limit < 1) limit = 1;
    if (limit > 200) limit = 200;

    final db = context.services.database.db;
    final counts = db.select(
      'SELECT tool, COUNT(*) AS n, '
      'SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_n '
      'FROM tool_audit_log WHERE at >= ? AND at < ? '
      'GROUP BY tool ORDER BY n DESC',
      [startUtc, endUtc],
    );
    final rows = db.select(
      'SELECT at, tool, caller, channel, ok, duration_ms '
      'FROM tool_audit_log WHERE at >= ? AND at < ? '
      'ORDER BY at ASC LIMIT ?',
      [startUtc, endUtc, limit],
    );
    final totalRow = db.select(
      'SELECT COUNT(*) AS n FROM tool_audit_log WHERE at >= ? AND at < ?',
      [startUtc, endUtc],
    );
    final total = totalRow.first['n'] as int;

    return ToolResult.ok({
      'day': '${dayStart.year.toString().padLeft(4, '0')}-'
          '${dayStart.month.toString().padLeft(2, '0')}-'
          '${dayStart.day.toString().padLeft(2, '0')}',
      'timezone': timestamps.timezoneName,
      'total_calls': total,
      'by_tool': [
        for (final row in counts)
          {
            'tool': row['tool'],
            'count': row['n'],
            'ok': row['ok_n'],
          },
      ],
      'events': [
        for (final row in rows)
          {
            'at': row['at'],
            'tool': row['tool'],
            'caller': row['caller'],
            'channel': row['channel'],
            'ok': (row['ok'] as int) == 1,
            'duration_ms': row['duration_ms'],
          },
      ],
      'truncated': total > rows.length,
    });
  }

  TZDateTime _dayStart(Timestamps timestamps, String? dayRaw) {
    final loc = timestamps.location;
    if (dayRaw == null || dayRaw.isEmpty) {
      final now = TZDateTime.now(loc);
      return TZDateTime(loc, now.year, now.month, now.day);
    }
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(dayRaw);
    if (m == null) {
      throw FormatException('day must be YYYY-MM-DD, got "$dayRaw"');
    }
    return TZDateTime(
      loc,
      int.parse(m.group(1)!),
      int.parse(m.group(2)!),
      int.parse(m.group(3)!),
    );
  }
}
