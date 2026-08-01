import '../../integrations/google_calendar_client.dart';
import '../tool.dart';

class CalendarListEventsTool extends Tool {
  @override
  String get name => 'calendar_list_events';

  @override
  String get description =>
      'Lists events across all calendars visible to the owner between '
      'time_min and time_max (local bot timezone or RFC 3339). Optional '
      'query filters by text. Owner-only. Use for "what\'s on my calendar".';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'time_min': {
            'type': 'string',
            'description':
                'Range start, e.g. "2026-08-02 00:00" (local) or RFC 3339.',
          },
          'time_max': {
            'type': 'string',
            'description':
                'Range end (exclusive-ish upper bound), same formats.',
          },
          'query': {
            'type': 'string',
            'description': 'Optional free-text filter.',
          },
        },
        'required': ['time_min', 'time_max'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final calendar = context.services.calendar;
    if (!calendar.isConfigured) {
      return ToolResult.error(GoogleCalendarSetupRequired().message);
    }
    final minRaw = (args['time_min'] as String?)?.trim() ?? '';
    final maxRaw = (args['time_max'] as String?)?.trim() ?? '';
    if (minRaw.isEmpty || maxRaw.isEmpty) {
      return ToolResult.error('time_min and time_max are required.');
    }
    try {
      final timestamps = context.services.timestamps;
      final timeMin = timestamps.parseToUtc(minRaw);
      final timeMax = timestamps.parseToUtc(maxRaw);
      if (!timeMax.isAfter(timeMin)) {
        return ToolResult.error('time_max must be after time_min.');
      }
      final events = await calendar.listEvents(
        timeMin: timeMin,
        timeMax: timeMax,
        query: (args['query'] as String?)?.trim(),
      );
      return ToolResult.ok({
        'count': events.length,
        'events': [
          for (final e in events) e.toJson(timestamps),
        ],
      });
    } on GoogleCalendarSetupRequired catch (error) {
      return ToolResult.error(error.message);
    } on FormatException catch (error) {
      return ToolResult.error(error.message);
    } catch (error) {
      return ToolResult.error('Calendar list failed: $error');
    }
  }
}
