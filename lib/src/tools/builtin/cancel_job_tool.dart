import '../../jobs/job_models.dart';
import '../../self_extension/self_extension_models.dart';
import '../tool.dart';

class CancelJobTool extends Tool {
  @override
  String get name => 'cancel_job';

  @override
  String get description =>
      'Cancels a research job or self-extension by id. Omit id to cancel the '
      'active research job, or the open self-extension when no job is active.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'id': {
            'type': 'integer',
            'description':
                'Job or self-extension id. Defaults to the active job, else '
                    'the open self-extension.',
          },
          'kind': {
            'type': 'string',
            'description':
                'Optional: "job" or "self_extension" when the id is ambiguous.',
            'enum': ['job', 'self_extension'],
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final kind = args['kind']?.toString().trim();
    int? id;
    final raw = args['id'];
    if (raw != null) {
      id = switch (raw) {
        int n => n,
        num n => n.toInt(),
        String s => int.tryParse(s),
        _ => null,
      };
      if (id == null) {
        return ToolResult.error('"id" must be an integer.');
      }
    }

    if (kind == 'self_extension' ||
        (kind == null && id != null && _isOpenExtension(context, id))) {
      return _cancelExtension(context, id!);
    }
    if (kind == 'self_extension' && id == null) {
      final open = context.services.selfExtensions.openExtension();
      if (open == null) {
        return ToolResult.error('No open self-extension to cancel.');
      }
      return _cancelExtension(context, open.id);
    }

    if (id == null) {
      id = context.services.jobs.activeJob()?.id;
      if (id == null) {
        final open = context.services.selfExtensions.openExtension();
        if (open != null) {
          return _cancelExtension(context, open.id);
        }
        return ToolResult.error('No active job or self-extension to cancel.');
      }
    }

    final job = context.services.jobs.byId(id);
    if (job == null) {
      // Maybe they meant a self-extension id.
      if (_isOpenExtension(context, id) ||
          context.services.selfExtensions.byId(id) != null) {
        return _cancelExtension(context, id);
      }
      return ToolResult.ok({'id': id, 'status': 'not_found'});
    }
    if (!JobStatus.open.contains(job.status)) {
      return ToolResult.ok({'id': id, 'status': job.status});
    }

    context.services.jobRunner.requestCancel(id);
    return ToolResult.ok({
      'id': id,
      'kind': 'job',
      'status': 'cancel_requested',
      'title': job.title,
      'message':
          'Cancel requested. The job will stop between steps/tool calls and '
              'post partial findings.',
    });
  }

  bool _isOpenExtension(ToolContext context, int id) {
    final ext = context.services.selfExtensions.byId(id);
    return ext != null && SelfExtensionStatus.open.contains(ext.status);
  }

  Future<ToolResult> _cancelExtension(ToolContext context, int id) async {
    final ext = context.services.selfExtensions.byId(id);
    if (ext == null) {
      return ToolResult.ok(
          {'id': id, 'kind': 'self_extension', 'status': 'not_found'});
    }
    if (!ext.isOpen) {
      return ToolResult.ok({
        'id': id,
        'kind': 'self_extension',
        'status': ext.status,
      });
    }
    await context.services.selfExtensionRunner.requestCancel(id);
    return ToolResult.ok({
      'id': id,
      'kind': 'self_extension',
      'status': 'cancelled',
      'message': 'Self-extension #$id cancelled.',
    });
  }
}
