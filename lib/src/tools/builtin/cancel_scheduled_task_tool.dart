import '../tool.dart';

class CancelScheduledTaskTool extends Tool {
  @override
  String get name => 'cancel_scheduled_task';

  @override
  String get description =>
      'Cancels a pending scheduled task by id. Non-owners may only cancel '
      'their own tasks.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'id': {
            'type': 'integer',
            'description': 'Task id from list_scheduled_tasks / schedule_task.',
          },
        },
        'required': ['id'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final raw = args['id'];
    final id = switch (raw) {
      int n => n,
      num n => n.toInt(),
      String s => int.tryParse(s),
      _ => null,
    };
    if (id == null) {
      return ToolResult.error('"id" must be an integer.');
    }

    final task = context.services.tasks.byId(id);
    if (task == null) {
      return ToolResult.ok({'id': id, 'status': 'not_found'});
    }
    if (!context.isOwner && task.createdBy != context.userId) {
      return ToolResult.error(
        'Task #$id belongs to someone else. Only the owner can cancel it.',
      );
    }
    final cancelled = context.services.tasks.cancel(id);
    return ToolResult.ok({
      'id': id,
      'status': cancelled ? 'cancelled' : task.status,
    });
  }
}
