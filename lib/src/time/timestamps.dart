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
  Timestamps(String timezoneName) {
    _ensureTimeZones();
    _location = getLocation(timezoneName);
  }

  late final Location _location;

  static String _two(int n) => n.toString().padLeft(2, '0');

  String format(DateTime instant) {
    final z = TZDateTime.from(instant.toUtc(), _location);
    return '${z.year}-${_two(z.month)}-${_two(z.day)} '
        '${_two(z.hour)}:${_two(z.minute)}:${_two(z.second)} '
        '${z.timeZoneName}';
  }

  String now() => format(DateTime.now());
}
