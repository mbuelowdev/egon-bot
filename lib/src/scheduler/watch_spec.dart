import 'dart:convert';

/// Parsed `watch` task payload (ARCHITECTURE.md §8).
class WatchSpec {
  WatchSpec({
    required this.url,
    required this.condition,
    required this.intervalMinutes,
    required this.untilTriggered,
  });

  final String url;
  final String condition;
  final int intervalMinutes;
  final bool untilTriggered;

  static const minIntervalMinutes = 15;
  static const maxWatchersPerUser = 3;

  Map<String, Object?> toJson() => {
        'url': url,
        'condition': condition,
        'interval_minutes': intervalMinutes,
        'until_triggered': untilTriggered,
      };

  String encode() => jsonEncode(toJson());

  static WatchSpec decode(String raw) {
    final map = jsonDecode(raw);
    if (map is! Map) {
      throw FormatException('Watch payload must be a JSON object.');
    }
    final m = map.cast<String, Object?>();
    final url = (m['url'] as String?)?.trim() ?? '';
    final condition = (m['condition'] as String?)?.trim() ?? '';
    final interval = m['interval_minutes'];
    final minutes = interval is int
        ? interval
        : int.tryParse(interval?.toString() ?? '') ?? 0;
    if (url.isEmpty || condition.isEmpty) {
      throw FormatException('Watch payload needs url and condition.');
    }
    if (minutes < minIntervalMinutes) {
      throw FormatException(
        'interval_minutes must be ≥ $minIntervalMinutes.',
      );
    }
    return WatchSpec(
      url: url,
      condition: condition,
      intervalMinutes: minutes,
      untilTriggered: m['until_triggered'] != false,
    );
  }
}

/// Snapshot persisted in `scheduled_tasks.state_json`.
class WatchState {
  WatchState({
    this.hash,
    this.snippet,
    this.consecutiveFailures = 0,
    this.lastCheckedAt,
  });

  final String? hash;
  final String? snippet;
  final int consecutiveFailures;
  final DateTime? lastCheckedAt;

  Map<String, Object?> toJson() => {
        'hash': hash,
        'snippet': snippet,
        'consecutive_failures': consecutiveFailures,
        'last_checked_at': lastCheckedAt?.toUtc().toIso8601String(),
      };

  String encode() => jsonEncode(toJson());

  static WatchState decode(String? raw) {
    if (raw == null || raw.trim().isEmpty) return WatchState();
    final map = jsonDecode(raw);
    if (map is! Map) return WatchState();
    final m = map.cast<String, Object?>();
    final failures = m['consecutive_failures'];
    return WatchState(
      hash: m['hash'] as String?,
      snippet: m['snippet'] as String?,
      consecutiveFailures: failures is int
          ? failures
          : int.tryParse(failures?.toString() ?? '') ?? 0,
      lastCheckedAt: m['last_checked_at'] == null
          ? null
          : DateTime.tryParse(m['last_checked_at'] as String),
    );
  }
}

/// Parses human interval strings into minutes and a 5-field cron.
///
/// Accepts `15m`, `30m`, `1h`, `2h`, plain minutes (`"15"`), or a cron
/// expression (returned with [intervalMinutes] derived when possible).
({int minutes, String cron}) parseWatchInterval(String raw) {
  final s = raw.trim();
  if (s.isEmpty) {
    throw FormatException('interval must not be empty');
  }

  // Already a cron?
  if (s.split(RegExp(r'\s+')).length == 5) {
    return (minutes: _minutesFromCron(s), cron: s);
  }

  final m = RegExp(
    r'^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$',
    caseSensitive: false,
  ).firstMatch(s);
  if (m == null) {
    throw FormatException(
      'interval must look like "15m", "1h", or a 5-field cron. Got: "$raw"',
    );
  }
  var minutes = int.parse(m.group(1)!);
  final unit = (m.group(2) ?? 'm').toLowerCase();
  if (unit.startsWith('h')) {
    minutes *= 60;
  }
  if (minutes < WatchSpec.minIntervalMinutes) {
    throw FormatException(
      'interval must be at least ${WatchSpec.minIntervalMinutes} minutes.',
    );
  }
  return (minutes: minutes, cron: intervalMinutesToCron(minutes));
}

String intervalMinutesToCron(int minutes) {
  if (minutes < WatchSpec.minIntervalMinutes) {
    throw FormatException(
      'interval must be at least ${WatchSpec.minIntervalMinutes} minutes.',
    );
  }
  if (minutes < 60) {
    return '*/$minutes * * * *';
  }
  if (minutes % 60 == 0) {
    final hours = minutes ~/ 60;
    if (hours == 1) return '0 * * * *';
    return '0 */$hours * * *';
  }
  // e.g. 90 → every 30 minutes (closest polite divisor ≥ 15).
  final divisor = _largestDivisorAtMost(minutes, 30);
  return '*/$divisor * * * *';
}

int _minutesFromCron(String cron) {
  final parts = cron.trim().split(RegExp(r'\s+'));
  final minute = parts[0];
  final hour = parts[1];
  final stepMin = RegExp(r'^\*/(\d+)$').firstMatch(minute);
  if (stepMin != null) return int.parse(stepMin.group(1)!);
  final stepHour = RegExp(r'^\*/(\d+)$').firstMatch(hour);
  if (minute == '0' && stepHour != null) {
    return int.parse(stepHour.group(1)!) * 60;
  }
  if (minute == '0' && hour == '*') return 60;
  return WatchSpec.minIntervalMinutes;
}

int _largestDivisorAtMost(int n, int cap) {
  for (var d = cap; d >= WatchSpec.minIntervalMinutes; d--) {
    if (n % d == 0) return d;
  }
  return WatchSpec.minIntervalMinutes;
}
