import 'package:egon_bot/src/tools/builtin/calendar_create_event_tool.dart';
import 'package:egon_bot/src/tools/builtin/calendar_list_events_tool.dart';
import 'package:egon_bot/src/time/timestamps.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('Timestamps.parseToUtc', () {
    final ts = Timestamps('Europe/Berlin');

    test('parses local wall clock in BOT_TIMEZONE', () {
      // 2026-01-15 10:00 CET = 09:00 UTC
      final utc = ts.parseToUtc('2026-01-15 10:00');
      expect(utc.isUtc, isTrue);
      expect(utc.hour, 9);
      expect(utc.day, 15);
    });

    test('parses RFC 3339 with Z', () {
      final utc = ts.parseToUtc('2026-08-01T12:30:00Z');
      expect(utc.toIso8601String(), '2026-08-01T12:30:00.000Z');
    });

    test('rejects empty', () {
      expect(() => ts.parseToUtc(''), throwsFormatException);
    });
  });

  group('calendar tools without credentials', () {
    test('list reports setup required', () async {
      final services = testServices(tools: [CalendarListEventsTool()]);
      final result = await CalendarListEventsTool().execute(
        contextFor(services, owner: true),
        {
          'time_min': '2026-08-01 00:00',
          'time_max': '2026-08-02 00:00',
        },
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('google_calendar_setup'));
    });

    test('create preview is null when calendar unavailable', () async {
      final services = testServices(tools: [CalendarCreateEventTool()]);
      final preview = await CalendarCreateEventTool().previewChange(
        contextFor(services, owner: true),
        {
          'summary': 'Dentist',
          'start': '2026-08-07 10:00',
          'end': '2026-08-07 11:00',
        },
      );
      expect(preview, isNull);
    });
  });
}
