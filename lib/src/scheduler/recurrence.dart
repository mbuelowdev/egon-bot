import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart';

bool _tzReady = false;

void ensureTimeZonesLoaded() {
  if (_tzReady) return;
  tz_data.initializeTimeZones();
  _tzReady = true;
}

/// Parses and evaluates classic 5-field cron expressions
/// (`minute hour day-of-month month day-of-week`).
///
/// Supported token forms per field: `*`, `n`, `n-m`, `*/step`, `n-m/step`,
/// and comma-separated lists of those. Day-of-week accepts `0`–`7`
/// (`0` and `7` = Sunday). When both day-of-month and day-of-week are
/// constrained, a time matches if **either** matches (Vixie cron).
class CronExpression {
  CronExpression._({
    required this.source,
    required this.minutes,
    required this.hours,
    required this.daysOfMonth,
    required this.months,
    required this.daysOfWeek,
    required this.domConstrained,
    required this.dowConstrained,
  });

  final String source;
  final Set<int> minutes;
  final Set<int> hours;
  final Set<int> daysOfMonth;
  final Set<int> months;
  final Set<int> daysOfWeek;
  final bool domConstrained;
  final bool dowConstrained;

  /// Throws [FormatException] when [source] is not a valid 5-field cron.
  factory CronExpression.parse(String source) {
    final parts = source.trim().split(RegExp(r'\s+'));
    if (parts.length != 5) {
      throw FormatException(
        'Cron must have 5 fields (got ${parts.length}): "$source"',
      );
    }
    final minutes = _parseField(parts[0], 0, 59, 'minute');
    final hours = _parseField(parts[1], 0, 23, 'hour');
    final daysOfMonth = _parseField(parts[2], 1, 31, 'day-of-month');
    final months = _parseField(parts[3], 1, 12, 'month');
    final daysOfWeek = _parseField(parts[4], 0, 7, 'day-of-week');

    // Normalize Sunday: cron allows both 0 and 7.
    final dow = <int>{for (final d in daysOfWeek) d == 7 ? 0 : d};

    return CronExpression._(
      source: source.trim(),
      minutes: minutes,
      hours: hours,
      daysOfMonth: daysOfMonth,
      months: months,
      daysOfWeek: dow,
      domConstrained: parts[2] != '*',
      dowConstrained: parts[4] != '*',
    );
  }

  bool matches(TZDateTime dt) {
    if (!minutes.contains(dt.minute)) return false;
    if (!hours.contains(dt.hour)) return false;
    if (!months.contains(dt.month)) return false;

    // Dart: Monday=1 … Sunday=7 → cron: Sunday=0 … Saturday=6
    final cronDow = dt.weekday % 7;
    final domOk = daysOfMonth.contains(dt.day);
    final dowOk = daysOfWeek.contains(cronDow);

    if (domConstrained && dowConstrained) {
      return domOk || dowOk;
    }
    if (domConstrained) return domOk;
    if (dowConstrained) return dowOk;
    return true;
  }
}

Set<int> _parseField(String field, int min, int max, String name) {
  final values = <int>{};
  for (final part in field.split(',')) {
    if (part.isEmpty) {
      throw FormatException('Empty $name token in "$field"');
    }
    values.addAll(_parseToken(part, min, max, name));
  }
  if (values.isEmpty) {
    throw FormatException('No valid values for $name in "$field"');
  }
  return values;
}

Iterable<int> _parseToken(String token, int min, int max, String name) {
  final stepSplit = token.split('/');
  if (stepSplit.length > 2) {
    throw FormatException('Bad $name token "$token"');
  }
  final rangePart = stepSplit[0];
  final step = stepSplit.length == 2 ? int.tryParse(stepSplit[1]) : 1;
  if (step == null || step < 1) {
    throw FormatException('Bad step in $name token "$token"');
  }

  final int start;
  final int end;
  if (rangePart == '*') {
    start = min;
    end = max;
  } else if (rangePart.contains('-')) {
    final bounds = rangePart.split('-');
    if (bounds.length != 2) {
      throw FormatException('Bad range in $name token "$token"');
    }
    start = int.tryParse(bounds[0]) ??
        (throw FormatException('Bad range start in $name token "$token"'));
    end = int.tryParse(bounds[1]) ??
        (throw FormatException('Bad range end in $name token "$token"'));
  } else {
    final single = int.tryParse(rangePart);
    if (single == null) {
      throw FormatException('Bad $name token "$token"');
    }
    start = single;
    end = single;
  }

  if (start < min || end > max || start > end) {
    throw FormatException(
      '$name values out of range $min–$max in "$token"',
    );
  }

  return [for (var v = start; v <= end; v += step) v];
}

/// Next matching instant strictly after [after], evaluated in [timezoneName].
/// Returns UTC. Uses wall-clock minutes so DST spring-forward gaps are
/// skipped and fall-back folds still land on a real local minute.
DateTime nextOccurrence({
  required CronExpression cron,
  required String timezoneName,
  required DateTime after,
  Duration searchLimit = const Duration(days: 730),
}) {
  ensureTimeZonesLoaded();
  final location = getLocation(timezoneName);
  final afterLocal = TZDateTime.from(after.toUtc(), location);

  var cursor = afterLocal.add(const Duration(minutes: 1));
  cursor = TZDateTime(
    location,
    cursor.year,
    cursor.month,
    cursor.day,
    cursor.hour,
    cursor.minute,
  );

  final limit = afterLocal.add(searchLimit);
  var guard = 0;
  const maxSteps = 730 * 24 * 60 + 10;
  while (cursor.isBefore(limit) && guard < maxSteps) {
    if (cron.matches(cursor)) {
      return cursor.toUtc();
    }
    final advanced = cursor.add(const Duration(minutes: 1));
    final normalized = TZDateTime(
      location,
      advanced.year,
      advanced.month,
      advanced.day,
      advanced.hour,
      advanced.minute,
    );
    // Spring-forward can make add()+normalize land on the same wall minute;
    // step via UTC in that case so we always make progress.
    cursor = normalized.isAfter(cursor)
        ? normalized
        : TZDateTime.from(
            cursor.toUtc().add(const Duration(minutes: 1)),
            location,
          );
    guard++;
  }
  throw StateError(
    'No cron occurrence of "${cron.source}" within '
    '${searchLimit.inDays} days after $after',
  );
}
