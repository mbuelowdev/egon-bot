import '../../scheduler/task_store.dart';
import '../tool.dart';

class ScheduleTaskTool extends Tool {
  @override
  String get name => 'schedule_task';

  @override
  String get description =>
      'Schedules a one-shot or recurring task. Convert natural-language times '
      'yourself using the current local time from the system prompt: pass '
      'due_at as an absolute ISO-8601 UTC timestamp (e.g. 2026-07-30T09:35:00Z) '
      'OR recurrence as a 5-field cron in the bot timezone '
      '(minute hour day-of-month month day-of-week), never both. '
      'kind=message posts payload verbatim (plain reminders); kind=agent runs '
      'a full agent turn with payload as the instruction. Defaults channel_id '
      'to the current channel.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'kind': {
            'type': 'string',
            'description':
                '"message" for plain reminders, "agent" for tool-using turns.',
            'enum': ['message', 'agent'],
          },
          'payload': {
            'type': 'string',
            'description':
                'Reminder text to post, or instruction for an agent turn. '
                'To ping someone in a kind=message payload, include their '
                'Discord mention token verbatim (<@userId>).',
          },
          'due_at': {
            'type': 'string',
            'description':
                'One-shot ISO-8601 UTC timestamp, e.g. "2026-07-30T09:35:00Z".',
          },
          'recurrence': {
            'type': 'string',
            'description':
                '5-field cron, e.g. "0 9 * * 1" = every Monday 09:00 local.',
          },
          'channel_id': {
            'type': 'string',
            'description':
                'Discord channel id to post into. Defaults to the current channel.',
          },
        },
        'required': ['kind', 'payload'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final kind = (args['kind'] as String?)?.trim() ?? '';
    final payload = (args['payload'] as String?)?.trim() ?? '';
    final dueRaw = (args['due_at'] as String?)?.trim();
    final recurrence = (args['recurrence'] as String?)?.trim();
    final channelId =
        ((args['channel_id'] as String?)?.trim().isNotEmpty ?? false)
            ? (args['channel_id'] as String).trim()
            : context.channelId;

    if (kind != TaskKind.message && kind != TaskKind.agent) {
      return ToolResult.error('kind must be "message" or "agent".');
    }
    if (payload.isEmpty) {
      return ToolResult.error('payload must not be empty.');
    }

    DateTime? dueAt;
    if (dueRaw != null && dueRaw.isNotEmpty) {
      dueAt = DateTime.tryParse(dueRaw);
      if (dueAt == null) {
        return ToolResult.error(
          'due_at must be ISO-8601 (e.g. 2026-07-30T09:35:00Z). Got: "$dueRaw"',
        );
      }
    }

    try {
      final task = context.services.tasks.create(
        createdBy: context.userId,
        channelId: channelId,
        kind: kind,
        payload: payload,
        timezone: context.services.config.botTimezone,
        dueAt: dueAt,
        recurrence:
            (recurrence == null || recurrence.isEmpty) ? null : recurrence,
      );
      return ToolResult.ok({
        'id': task.id,
        'kind': task.kind,
        'status': task.status,
        'next_run_at': task.nextRunAt.toUtc().toIso8601String(),
        'recurrence': task.recurrence,
        'channel_id': task.channelId,
      });
    } on FormatException catch (error) {
      return ToolResult.error('Invalid schedule: $error');
    } on ArgumentError catch (error) {
      return ToolResult.error('Invalid schedule: ${error.message}');
    }
  }
}
