import '../../integrations/google_calendar_client.dart';
import '../tool.dart';

class CalendarCreateEventTool extends Tool {
  @override
  String get name => 'calendar_create_event';

  @override
  String get description =>
      'Creates an event on the dedicated Egon calendar. Owner-only. Always '
      'shows a preview for approval. Pass start/end in local bot time or '
      'RFC 3339.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'summary': {
            'type': 'string',
            'description': 'Event title.',
          },
          'start': {
            'type': 'string',
            'description': 'Start time (local or RFC 3339).',
          },
          'end': {
            'type': 'string',
            'description': 'End time (local or RFC 3339).',
          },
          'description': {'type': 'string'},
          'location': {'type': 'string'},
        },
        'required': ['summary', 'start', 'end'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    if (!context.services.calendar.isConfigured) return null;
    final summary = (args['summary'] as String?)?.trim() ?? '';
    final startRaw = (args['start'] as String?)?.trim() ?? '';
    final endRaw = (args['end'] as String?)?.trim() ?? '';
    if (summary.isEmpty || startRaw.isEmpty || endRaw.isEmpty) return null;
    try {
      final ts = context.services.timestamps;
      final start = ts.parseToUtc(startRaw);
      final end = ts.parseToUtc(endRaw);
      final desc = (args['description'] as String?)?.trim();
      final loc = (args['location'] as String?)?.trim();
      return 'Create on Egon calendar:\n'
          'Title: $summary\n'
          'Start: ${ts.format(start)}\n'
          'End: ${ts.format(end)}\n'
          'Description: ${desc == null || desc.isEmpty ? '(none)' : desc}\n'
          'Location: ${loc == null || loc.isEmpty ? '(none)' : loc}';
    } catch (_) {
      return null;
    }
  }

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final calendar = context.services.calendar;
    if (!calendar.isConfigured) {
      return ToolResult.error(GoogleCalendarSetupRequired().message);
    }
    final summary = (args['summary'] as String?)?.trim() ?? '';
    final startRaw = (args['start'] as String?)?.trim() ?? '';
    final endRaw = (args['end'] as String?)?.trim() ?? '';
    if (summary.isEmpty || startRaw.isEmpty || endRaw.isEmpty) {
      return ToolResult.error('summary, start, and end are required.');
    }
    try {
      final ts = context.services.timestamps;
      final start = ts.parseToUtc(startRaw);
      final end = ts.parseToUtc(endRaw);
      if (!end.isAfter(start)) {
        return ToolResult.error('end must be after start.');
      }
      final created = await calendar.createEvent(
        summary: summary,
        start: start,
        end: end,
        description: (args['description'] as String?)?.trim(),
        location: (args['location'] as String?)?.trim(),
      );
      return ToolResult.ok({
        'status': 'created',
        'event': created.toJson(ts),
      });
    } on GoogleCalendarSetupRequired catch (error) {
      return ToolResult.error(error.message);
    } on FormatException catch (error) {
      return ToolResult.error(error.message);
    } catch (error) {
      return ToolResult.error('Create event failed: $error');
    }
  }
}
