import '../../jobs/job_models.dart';
import '../tool.dart';

class StartJobTool extends Tool {
  @override
  String get name => 'start_job';

  @override
  String get description =>
      'Starts a long-running multi-step job (research, multi-site checks, '
      'write-ups). Use when the request will take more than one chat turn or '
      'needs a plan. Pass the user\'s full instructions verbatim. Returns the '
      'job id and whether it started immediately or was queued.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'instructions': {
            'type': 'string',
            'description': 'Full user request for the job, verbatim.',
          },
          'title': {
            'type': 'string',
            'description': 'Optional short label. The planner may refine it.',
          },
          'channel_id': {
            'type': 'string',
            'description':
                'Channel for progress posts. Defaults to the current channel.',
          },
        },
        'required': ['instructions'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final instructions = (args['instructions'] as String?)?.trim() ?? '';
    if (instructions.isEmpty) {
      return ToolResult.error('instructions must not be empty.');
    }
    final title = (args['title'] as String?)?.trim();
    final channelId =
        ((args['channel_id'] as String?)?.trim().isNotEmpty ?? false)
            ? (args['channel_id'] as String).trim()
            : context.channelId;

    final active = context.services.jobs.activeJob();
    final job = context.services.jobRunner.enqueue(
      createdBy: context.userId,
      channelId: channelId,
      instructions: instructions,
      titleHint: title,
    );

    if (active != null) {
      return ToolResult.ok({
        'id': job.id,
        'status': JobStatus.queued,
        'title': job.title,
        'message':
            'Queued behind "${active.title}" (#${active.id}). It will start '
                'when that job finishes, waits for input, or is cancelled.',
      });
    }
    return ToolResult.ok({
      'id': job.id,
      'status': JobStatus.queued,
      'title': job.title,
      'message': 'Job queued and starting shortly.',
    });
  }
}
