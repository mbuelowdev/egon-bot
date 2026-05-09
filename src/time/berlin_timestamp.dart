import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart';

bool _timeZonesLoaded = false;

void _ensureTimeZones() {
  if (_timeZonesLoaded) {
    return;
  }
  tz_data.initializeTimeZones();
  _timeZonesLoaded = true;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Discord timestamps are UTC; prompts use local Germany time (Europe/Berlin, DST-aware).
String formatEuropeBerlinForPrompt(DateTime instant) {
  _ensureTimeZones();
  final z = TZDateTime.from(instant.toUtc(), getLocation('Europe/Berlin'));

  return '${z.year}-${_two(z.month)}-${_two(z.day)} '
      '${_two(z.hour)}:${_two(z.minute)}:${_two(z.second)} '
      '${z.timeZoneName}';
}
