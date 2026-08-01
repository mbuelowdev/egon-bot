import '../../scheduler/task_store.dart';
import '../../scheduler/watch_spec.dart';
import '../../web/ssrf_guard.dart';
import '../tool.dart';

class WatchUrlTool extends Tool {
  @override
  String get name => 'watch_url';

  @override
  String get description =>
      'Starts a scheduled web watcher that periodically fetches a URL and '
      'alerts this channel when a natural-language condition becomes true '
      '(e.g. "ticket shop is live"). Interval ≥ 15 minutes ("15m", "1h", or '
      'cron). until_triggered defaults to true (stops after the first hit). '
      'Whitelisted users may have at most 3 active watchers; the owner is '
      'uncapped. Cancel with cancel_scheduled_task.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'url': {
            'type': 'string',
            'description': 'http(s) URL to poll.',
          },
          'condition': {
            'type': 'string',
            'description':
                'Natural-language condition to detect, e.g. "tickets are on sale".',
          },
          'interval': {
            'type': 'string',
            'description':
                'Poll interval: "15m", "30m", "1h", or a 5-field cron. Min 15m.',
          },
          'until_triggered': {
            'type': 'boolean',
            'description':
                'If true (default), stop after the first alert. If false, keep watching.',
          },
          'channel_id': {
            'type': 'string',
            'description': 'Alert channel. Defaults to the current channel.',
          },
        },
        'required': ['url', 'condition', 'interval'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final url = (args['url'] as String?)?.trim() ?? '';
    final condition = (args['condition'] as String?)?.trim() ?? '';
    final intervalRaw = (args['interval'] as String?)?.trim() ?? '';
    final untilTriggered = args['until_triggered'] != false;
    final channelId =
        ((args['channel_id'] as String?)?.trim().isNotEmpty ?? false)
            ? (args['channel_id'] as String).trim()
            : context.channelId;

    if (url.isEmpty || condition.isEmpty || intervalRaw.isEmpty) {
      return ToolResult.error('url, condition, and interval are required.');
    }

    try {
      await assertPublicHttpUri(Uri.parse(url));
    } on SsrfBlockedException catch (error) {
      return ToolResult.error(error.message);
    } on FormatException catch (error) {
      return ToolResult.error('Invalid url: $error');
    }

    final ({int minutes, String cron}) parsed;
    try {
      parsed = parseWatchInterval(intervalRaw);
    } on FormatException catch (error) {
      return ToolResult.error(error.message);
    }

    final isOwner = context.isOwner;
    if (!isOwner) {
      final existing = context.services.tasks
          .list(status: TaskStatus.pending, createdBy: context.userId)
          .where((t) => t.kind == TaskKind.watch)
          .length;
      if (existing >= WatchSpec.maxWatchersPerUser) {
        return ToolResult.error(
          'Watcher cap reached (${WatchSpec.maxWatchersPerUser} per user). '
          'Cancel one with cancel_scheduled_task first.',
        );
      }
    }

    final spec = WatchSpec(
      url: url,
      condition: condition,
      intervalMinutes: parsed.minutes,
      untilTriggered: untilTriggered,
    );

    try {
      final task = context.services.tasks.create(
        createdBy: context.userId,
        channelId: channelId,
        kind: TaskKind.watch,
        payload: spec.encode(),
        timezone: context.services.config.botTimezone,
        recurrence: parsed.cron,
        stateJson: WatchState().encode(),
      );
      return ToolResult.ok({
        'id': task.id,
        'kind': task.kind,
        'url': url,
        'condition': condition,
        'interval_minutes': parsed.minutes,
        'recurrence': task.recurrence,
        'until_triggered': untilTriggered,
        'next_run_at': task.nextRunAt.toUtc().toIso8601String(),
        'channel_id': task.channelId,
      });
    } on FormatException catch (error) {
      return ToolResult.error('Invalid watcher: $error');
    } on ArgumentError catch (error) {
      return ToolResult.error('Invalid watcher: ${error.message}');
    }
  }
}
