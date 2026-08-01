import '../../integrations/google_calendar_client.dart';
import '../tool.dart';

class CalendarDeleteEventTool extends Tool {
  @override
  String get name => 'calendar_delete_event';

  @override
  String get description =>
      'Deletes an event from the Egon calendar by event_id. Owner-only. '
      'Preview-approved. Cannot delete events on other calendars.';

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
    try {
      final existing = await context.services.calendar.getWriteEvent(eventId);
      if (existing == null) {
        return 'Delete from Egon calendar: event_id=$eventId '
            '(not found or not on Egon — delete will fail).';
      }
      return 'Delete from Egon calendar:\n'
          'Id: ${existing.id}\n'
          'Title: ${existing.summary}\n'
          'Start: ${ts.format(existing.start)}\n'
          'End: ${ts.format(existing.end)}';
    } on GoogleCalendarSetupRequired {
      return null;
    } catch (_) {
      return 'Delete from Egon calendar: event_id=$eventId';
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
    final eventId = (args['event_id'] as String?)?.trim() ?? '';
    if (eventId.isEmpty) {
      return ToolResult.error('event_id is required.');
    }
    try {
      await calendar.deleteEvent(eventId);
      return ToolResult.ok({'status': 'deleted', 'event_id': eventId});
    } on GoogleCalendarSetupRequired catch (error) {
      return ToolResult.error(error.message);
    } catch (error) {
      return ToolResult.error('Delete event failed: $error');
    }
  }
}
