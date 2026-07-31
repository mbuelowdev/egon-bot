import '../../jobs/job_models.dart';
import '../../scheduler/task_store.dart';
import '../tool.dart';

class StatusOverviewTool extends Tool {
  @override
  String get name => 'status_overview';

  @override
  String get description =>
      'Returns a snapshot of everything the bot is working on: active/queued/'
      'waiting jobs, next scheduled tasks, pending approvals, and GPU gate '
      'state. Use when the owner asks what you are doing or for a status check.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': <String, Object?>{},
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final jobs = context.services.jobs;
    final active = jobs.activeJob();
    final queued = jobs.list(statuses: {JobStatus.queued}, limit: 10);
    final waiting = jobs.list(statuses: {JobStatus.waitingUser}, limit: 10);
    final upcoming = context.services.tasks.list(
      status: TaskStatus.pending,
      limit: 5,
    );
    final watchers = upcoming.where((t) => t.kind == TaskKind.watch).toList();
    final reminders = upcoming.where((t) => t.kind != TaskKind.watch).toList();

    final pendingApprovals = context.services.database.db.select(
      "SELECT id, tool_name, requested_by, channel_id, created_at "
      "FROM pending_approvals WHERE status = 'pending' "
      'ORDER BY id ASC LIMIT 10',
    );

    final gpuFree = await context.services.llmGate.isGpuFree();
    final gate = context.services.llmGate;

    return ToolResult.ok({
      'active_job': active == null
          ? null
          : {
              'id': active.id,
              'title': active.title,
              'status': active.status,
              'current_step': active.currentStep,
              'steps': active.plan.length,
              'elapsed_minutes': DateTime.now()
                  .toUtc()
                  .difference(active.updatedAt.toUtc())
                  .inMinutes,
              'step_description':
                  active.currentStep == null || active.plan.isEmpty
                      ? null
                      : active
                          .plan[(active.currentStep! - 1)
                              .clamp(0, active.plan.length - 1)]
                          .description,
            },
      'queued_jobs': [
        for (final j in queued)
          {'id': j.id, 'title': j.title, 'channel_id': j.channelId},
      ],
      'waiting_user': [
        for (final j in waiting)
          {
            'id': j.id,
            'title': j.title,
            'question': j.question,
            'channel_id': j.channelId,
          },
      ],
      'next_scheduled_tasks': [
        for (final t in reminders)
          {
            'id': t.id,
            'kind': t.kind,
            'payload': t.payload,
            'next_run_at': t.nextRunAt.toUtc().toIso8601String(),
            'recurrence': t.recurrence,
          },
      ],
      'watchers': [
        for (final t in watchers)
          {
            'id': t.id,
            'payload': t.payload,
            'next_run_at': t.nextRunAt.toUtc().toIso8601String(),
            'last_run_at': t.lastRunAt?.toUtc().toIso8601String(),
          },
      ],
      'pending_approvals': [
        for (final row in pendingApprovals)
          {
            'id': row['id'],
            'tool': row['tool_name'],
            'requested_by': row['requested_by'],
            'channel_id': row['channel_id'],
            'created_at': row['created_at'],
          },
      ],
      'gpu_gate': {
        'free': gpuFree,
        'queued_big_jobs': gate.queuedBigJobs,
        'utility_tier': gate.hasUtilityTier,
      },
    });
  }
}
