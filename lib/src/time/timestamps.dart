import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart';

bool _timeZonesLoaded = false;

void _ensureTimeZones() {
  if (_timeZonesLoaded) return;
  tz_data.initializeTimeZones();
  _timeZonesLoaded = true;
}

/// Formats instants in the bot's configured timezone for prompts.
/// Discord timestamps are UTC; the model reasons in local time.
class Timestamps {
  Timestamps(this.timezoneName) {
    _ensureTimeZones();
    _location = getLocation(timezoneName);
  }

  /// IANA name, e.g. `Europe/Berlin`.
  final String timezoneName;

  late final Location _location;

  Location get location => _location;

  static String _two(int n) => n.toString().padLeft(2, '0');

  String format(DateTime instant) {
    final z = TZDateTime.from(instant.toUtc(), _location);
    return '${z.year}-${_two(z.month)}-${_two(z.day)} '
        '${_two(z.hour)}:${_two(z.minute)}:${_two(z.second)} '
        '${z.timeZoneName}';
  }

  String now() => format(DateTime.now());

  /// Parses a local wall-clock string in [timezoneName] to UTC.
  ///
  /// Accepts `YYYY-MM-DDTHH:MM[:SS]`, `YYYY-MM-DD HH:MM[:SS]`, or a full
  /// RFC 3339 / ISO-8601 instant (converted via [DateTime.parse]).
  DateTime parseToUtc(String raw) {
    final s = raw.trim();
    if (s.isEmpty) {
      throw FormatException('Empty timestamp.');
    }
    // Explicit offset / Z → absolute instant.
    if (RegExp(r'(Z|[+-]\d{2}:?\d{2})$').hasMatch(s)) {
      return DateTime.parse(s).toUtc();
    }
    final m = RegExp(
      r'^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?',
    ).firstMatch(s);
    if (m == null) {
      throw FormatException('Unrecognized timestamp: $raw');
    }
    final local = TZDateTime(
      _location,
      int.parse(m.group(1)!),
      int.parse(m.group(2)!),
      int.parse(m.group(3)!),
      int.parse(m.group(4)!),
      int.parse(m.group(5)!),
      int.parse(m.group(6) ?? '0'),
    );
    return local.toUtc();
  }
}
