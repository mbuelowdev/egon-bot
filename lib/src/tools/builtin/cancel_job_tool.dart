import '../../jobs/job_models.dart';
import '../tool.dart';

class CancelJobTool extends Tool {
  @override
  String get name => 'cancel_job';

  @override
  String get description =>
      'Cancels a job by id. The runner finishes the current tool call, then '
      'stops and posts partial findings. Omit id to cancel the active job.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'id': {
            'type': 'integer',
            'description': 'Job id. Defaults to the currently active job.',
          },
        },
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
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
    } else {
      id = context.services.jobs.activeJob()?.id;
      if (id == null) {
        return ToolResult.error('No active job to cancel.');
      }
    }

    final job = context.services.jobs.byId(id);
    if (job == null) {
      return ToolResult.ok({'id': id, 'status': 'not_found'});
    }
    if (!JobStatus.open.contains(job.status)) {
      return ToolResult.ok({'id': id, 'status': job.status});
    }

    context.services.jobRunner.requestCancel(id);
    return ToolResult.ok({
      'id': id,
      'status': 'cancel_requested',
      'title': job.title,
      'message':
          'Cancel requested. The job will stop between steps/tool calls and '
              'post partial findings.',
    });
  }
}
