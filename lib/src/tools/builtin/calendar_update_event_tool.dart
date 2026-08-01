import '../../integrations/google_calendar_client.dart';
import '../tool.dart';

class CalendarUpdateEventTool extends Tool {
  @override
  String get name => 'calendar_update_event';

  @override
  String get description =>
      'Updates an event on the Egon calendar by event_id. Owner-only. '
      'Preview-approved. Only pass fields that should change.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'event_id': {
            'type': 'string',
            'description': 'Google event id from calendar_list_events.',
          },
          'summary': {'type': 'string'},
          'start': {'type': 'string'},
          'end': {'type': 'string'},
          'description': {'type': 'string'},
          'location': {'type': 'string'},
        },
        'required': ['event_id'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    if (!context.services.calendar.isConfigured) return null;
    final eventId = (args['event_id'] as String?)?.trim() ?? '';
    if (eventId.isEmpty) return null;
    final ts = context.services.timestamps;
    final buf = StringBuffer('Update on Egon calendar (id=$eventId):\n');
    var any = false;
    void line(String label, Object? value) {
      if (value == null) return;
      final s = value.toString().trim();
      if (s.isEmpty) return;
      buf.writeln('$label: $s');
      any = true;
    }

    line('Title', args['summary']);
    try {
      if (args['start'] != null) {
        line('Start', ts.format(ts.parseToUtc(args['start'].toString())));
      }
      if (args['end'] != null) {
        line('End', ts.format(ts.parseToUtc(args['end'].toString())));
      }
    } catch (_) {
      return null;
    }
    line('Description', args['description']);
    line('Location', args['location']);
    if (!any) {
      return 'Update event $eventId (no field changes specified).';
    }
    return buf.toString().trimRight();
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
    final eventId = (args['event_id'] as String?)?.trim() ?? '';
    if (eventId.isEmpty) {
      return ToolResult.error('event_id is required.');
    }
    try {
      final ts = context.services.timestamps;
      final updated = await calendar.updateEvent(
        eventId: eventId,
        summary: (args['summary'] as String?)?.trim(),
        start: args['start'] != null
            ? ts.parseToUtc(args['start'].toString())
            : null,
        end: args['end'] != null ? ts.parseToUtc(args['end'].toString()) : null,
        description: args.containsKey('description')
            ? (args['description'] as String?)?.trim()
            : null,
        location: args.containsKey('location')
            ? (args['location'] as String?)?.trim()
            : null,
      );
      return ToolResult.ok({
        'status': 'updated',
        'event': updated.toJson(ts),
      });
    } on GoogleCalendarSetupRequired catch (error) {
      return ToolResult.error(error.message);
    } on FormatException catch (error) {
      return ToolResult.error(error.message);
    } catch (error) {
      return ToolResult.error('Update event failed: $error');
    }
  }
}
