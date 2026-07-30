import 'package:egon_bot/src/scheduler/recurrence.dart';
import 'package:test/test.dart';
import 'package:timezone/timezone.dart';

void main() {
  ensureTimeZonesLoaded();
  final berlin = getLocation('Europe/Berlin');

  group('CronExpression.parse', () {
    test('rejects wrong field counts', () {
      expect(() => CronExpression.parse('* * *'), throwsFormatException);
      expect(() => CronExpression.parse('* * * * * *'), throwsFormatException);
    });

    test('parses ranges, lists, and steps', () {
      final cron = CronExpression.parse('0,15,30-45/5 9-17 * * 1-5');
      expect(cron.minutes.contains(0), isTrue);
      expect(cron.minutes.contains(15), isTrue);
      expect(cron.minutes.contains(30), isTrue);
      expect(cron.minutes.contains(35), isTrue);
      expect(cron.minutes.contains(45), isTrue);
      expect(cron.minutes.contains(46), isFalse);
      expect(cron.hours.contains(9), isTrue);
      expect(cron.hours.contains(17), isTrue);
      expect(cron.daysOfWeek.contains(1), isTrue);
      expect(cron.daysOfWeek.contains(0), isFalse);
    });

    test('treats day-of-week 7 as Sunday', () {
      final cron = CronExpression.parse('0 12 * * 7');
      expect(cron.daysOfWeek, {0});
    });
  });

  group('nextOccurrence', () {
    test('finds the next hourly slot', () {
      final cron = CronExpression.parse('0 * * * *');
      final after = DateTime.utc(2026, 7, 30, 10, 15);
      final next = nextOccurrence(
        cron: cron,
        timezoneName: 'UTC',
        after: after,
      );
      expect(next, DateTime.utc(2026, 7, 30, 11));
    });

    test('weekly Monday 09:00 Europe/Berlin', () {
      final cron = CronExpression.parse('0 9 * * 1');
      // Thursday 2026-07-30 08:00 Berlin = 06:00 UTC (CEST, UTC+2)
      final after = TZDateTime(berlin, 2026, 7, 30, 8).toUtc();
      final next = nextOccurrence(
        cron: cron,
        timezoneName: 'Europe/Berlin',
        after: after,
      );
      final local = TZDateTime.from(next, berlin);
      expect(local.weekday, DateTime.monday);
      expect(local.hour, 9);
      expect(local.minute, 0);
      expect(local.day, 3); // 2026-08-03
      expect(local.month, 8);
    });

    test('spring-forward gap: 02:30 CEST does not exist on 2026-03-29', () {
      // Europe/Berlin springs forward 2026-03-29 02:00 → 03:00.
      // From March 28 noon, the next 02:30 skips the missing March 29 slot
      // and lands on March 30.
      final cron = CronExpression.parse('30 2 * * *');
      final after = TZDateTime(berlin, 2026, 3, 28, 12).toUtc();
      final next = nextOccurrence(
        cron: cron,
        timezoneName: 'Europe/Berlin',
        after: after,
      );
      final local = TZDateTime.from(next, berlin);
      expect(local.day, 30);
      expect(local.month, 3);
      expect(local.hour, 2);
      expect(local.minute, 30);
    });

    test('fall-back: 02:30 still matches on 2026-10-25', () {
      // Europe/Berlin falls back 2026-10-25 03:00 → 02:00.
      final cron = CronExpression.parse('30 2 * * *');
      final after = TZDateTime(berlin, 2026, 10, 24, 12).toUtc();
      final next = nextOccurrence(
        cron: cron,
        timezoneName: 'Europe/Berlin',
        after: after,
      );
      final local = TZDateTime.from(next, berlin);
      expect(local.year, 2026);
      expect(local.month, 10);
      expect(local.day, 25);
      expect(local.hour, 2);
      expect(local.minute, 30);
    });
  });
}
