import '../../scheduler/task_store.dart';
import '../tool.dart';

class ListScheduledTasksTool extends Tool {
  @override
  String get name => 'list_scheduled_tasks';

  @override
  String get description =>
      'Lists scheduled tasks. Defaults to pending tasks. Owner sees everyone\'s '
      'tasks; other users only see their own.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'status': {
            'type': 'string',
            'description':
                'Filter: pending (default), done, cancelled, missed, or all.',
          },
          'limit': {
            'type': 'integer',
            'description': 'Max rows (default 20, max 50).',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final statusRaw = (args['status'] as String?)?.trim().toLowerCase();
    final status = switch (statusRaw) {
      null || '' || 'pending' => TaskStatus.pending,
      'all' => null,
      'done' || 'cancelled' || 'missed' => statusRaw,
      _ => null,
    };
    if (statusRaw != null &&
        statusRaw.isNotEmpty &&
        statusRaw != 'all' &&
        statusRaw != 'pending' &&
        statusRaw != 'done' &&
        statusRaw != 'cancelled' &&
        statusRaw != 'missed') {
      return ToolResult.error(
        'status must be pending, done, cancelled, missed, or all.',
      );
    }

    final limit = switch (args['limit']) {
      int n => n.clamp(1, 50),
      num n => n.toInt().clamp(1, 50),
      _ => 20,
    };

    final tasks = context.services.tasks.list(
      status: status,
      createdBy: context.isOwner ? null : context.userId,
      limit: limit,
    );

    return ToolResult.ok({
      'tasks': [
        for (final t in tasks)
          {
            'id': t.id,
            'kind': t.kind,
            'payload': t.payload,
            'status': t.status,
            'next_run_at': t.nextRunAt.toUtc().toIso8601String(),
            'recurrence': t.recurrence,
            'channel_id': t.channelId,
            'created_by': t.createdBy,
          },
      ],
    });
  }
}
