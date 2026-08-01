import 'dart:async';
import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../agent/agent.dart';
import '../agent/context_builder.dart';
import '../discord/discord_actions.dart';
import '../services.dart';
import 'recurrence.dart';
import 'task_store.dart';
import 'watcher.dart';

/// Periodic runner for `scheduled_tasks` (ARCHITECTURE.md §8).
///
/// - 30 s tick pulls due `pending` rows
/// - `message` posts verbatim (no LLM); `agent` runs a full agent turn
/// - GPU busy → `agent` tasks deferred +5 minutes in SQLite
/// - Boot recovery: one-shots ≤6 h late fire with "(delayed)"; older →
///   `missed` + owner notice; recurring skip to the next occurrence
class Scheduler {
  Scheduler({
    required this.services,
    required this.agent,
    required this.history,
    required this.store,
    this.tickInterval = const Duration(seconds: 30),
    this.lateGrace = const Duration(hours: 6),
    this.gpuDefer = const Duration(minutes: 5),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final Services services;
  final Agent agent;
  final ChannelHistoryStore history;
  final TaskStore store;
  final Duration tickInterval;
  final Duration lateGrace;
  final Duration gpuDefer;
  final DateTime Function() _clock;

  NyxxGateway? _client;
  Timer? _timer;
  bool _ticking = false;

  /// Attach a live Discord client, recover overdue tasks, start the tick.
  Future<void> start(NyxxGateway client) async {
    _client = client;
    await recoverOverdue();
    _timer?.cancel();
    _timer = Timer.periodic(tickInterval, (_) {
      unawaited(tick());
    });
    // Also run once immediately so short due_at values don't wait a full tick.
    unawaited(tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _client = null;
  }

  /// Boot / reconnect downtime policy (§8).
  Future<void> recoverOverdue({DateTime? now}) async {
    final at = (now ?? _clock()).toUtc();
    final overdue = store.dueAtOrBefore(at);
    for (final task in overdue) {
      try {
        await _recoverOne(task, at);
      } catch (error, stackTrace) {
        stderr.writeln(
          'Scheduler recover failed for #${task.id}: $error\n$stackTrace',
        );
      }
    }
  }

  Future<void> _recoverOne(ScheduledTask task, DateTime now) async {
    if (task.isRecurring) {
      final cron = CronExpression.parse(task.recurrence!);
      final next = nextOccurrence(
        cron: cron,
        timezoneName: task.timezone,
        after: now,
      );
      store.deferNextRun(task.id, next);
      stdout.writeln(
        'Scheduler: recurring #${task.id} skipped missed runs → next $next',
      );
      return;
    }

    final lateBy = now.difference(task.nextRunAt);
    if (lateBy <= lateGrace) {
      await _fire(task, delayed: true, now: now);
    } else {
      store.markMissed(task.id);
      await _post(
        task.channelId,
        'Missed scheduled task #${task.id} '
        '(was due ${task.nextRunAt.toUtc().toIso8601String()}): '
        '${task.payload}',
      );
      await _notifyOwnerMissed(task);
      stdout.writeln('Scheduler: one-shot #${task.id} marked missed');
    }
  }

  /// One tick: fire every currently due pending task.
  Future<void> tick({DateTime? now}) async {
    if (_ticking) return;
    _ticking = true;
    try {
      final at = (now ?? _clock()).toUtc();
      final due = store.dueAtOrBefore(at);
      for (final task in due) {
        try {
          await _fire(task, delayed: false, now: at);
        } catch (error, stackTrace) {
          stderr.writeln(
            'Scheduler fire failed for #${task.id}: $error\n$stackTrace',
          );
        }
      }
    } finally {
      _ticking = false;
    }
  }

  Future<void> _fire(
    ScheduledTask task, {
    required bool delayed,
    required DateTime now,
  }) async {
    // Re-read — another tick / recover may have moved it.
    final current = store.byId(task.id);
    if (current == null || current.status != TaskStatus.pending) return;
    if (current.nextRunAt.isAfter(now)) return;

    switch (current.kind) {
      case TaskKind.message:
        await _fireMessage(current, delayed: delayed, now: now);
      case TaskKind.agent:
        await _fireAgent(current, delayed: delayed, now: now);
      case TaskKind.watch:
        await _fireWatch(current, now: now);
      default:
        stderr.writeln(
          'Scheduler: unknown kind "${current.kind}" on #${current.id}',
        );
        store.markMissed(current.id);
    }
  }

  Future<void> _fireMessage(
    ScheduledTask task, {
    required bool delayed,
    required DateTime now,
  }) async {
    final text = delayed ? '(delayed) ${task.payload}' : task.payload;
    await _post(task.channelId, text);
    await _completeOrReschedule(task, now: now);
  }

  Future<void> _fireAgent(
    ScheduledTask task, {
    required bool delayed,
    required DateTime now,
  }) async {
    final gpuFree = await services.llmGate.isGpuFree();
    if (!gpuFree) {
      final deferred = now.add(gpuDefer);
      store.deferNextRun(task.id, deferred);
      stdout.writeln(
        'Scheduler: agent #${task.id} deferred to $deferred (GPU busy)',
      );
      return;
    }

    final isDm = !services.config.allowedChannelIds.contains(task.channelId);
    final content = delayed
        ? '${task.payload}\n\n(Note: this scheduled task is running delayed.)'
        : task.payload;

    final incoming = IncomingMessage(
      channelId: task.channelId,
      authorId: task.createdBy,
      authorName: 'Scheduler',
      content: content,
      timestamp: now,
      isDm: isDm,
    );

    Future<void> send(String text) async {
      if (text.trim().isEmpty) return;
      await _post(task.channelId, text);
      history.add(
        task.channelId,
        ChannelMessage(
          timestamp: DateTime.now(),
          authorId: 'scheduler',
          authorName: 'Egon',
          content: text,
        ),
      );
    }

    await agent.handleMessage(incoming, send);
    await _completeOrReschedule(task, now: now);
  }

  Future<void> _fireWatch(
    ScheduledTask task, {
    required DateTime now,
  }) async {
    final result = await Watcher(services).run(task);
    if (result.alert != null) {
      await _post(task.channelId, result.alert!);
    }
    if (result.ownerWarning != null) {
      await _notifyOwnerText(result.ownerWarning!);
    }

    if (result.done) {
      // Persist final snapshot then close.
      store.updateAfterRun(
        id: task.id,
        ranAt: now,
        nextRunAt: now,
        stateJson: result.state.encode(),
      );
      store.markDone(task.id, ranAt: now);
      stdout.writeln('Scheduler: watch #${task.id} triggered → done');
      return;
    }

    if (task.isRecurring) {
      final cron = CronExpression.parse(task.recurrence!);
      final next = nextOccurrence(
        cron: cron,
        timezoneName: task.timezone,
        after: now,
      );
      store.updateAfterRun(
        id: task.id,
        ranAt: now,
        nextRunAt: next,
        stateJson: result.state.encode(),
      );
      stdout.writeln('Scheduler: watch #${task.id} checked → next $next');
    } else {
      // Should not happen for watch_url (always recurring), but be safe.
      store.markDone(task.id, ranAt: now);
    }
  }

  Future<void> _completeOrReschedule(
    ScheduledTask task, {
    required DateTime now,
  }) async {
    if (task.isRecurring) {
      final cron = CronExpression.parse(task.recurrence!);
      final next = nextOccurrence(
        cron: cron,
        timezoneName: task.timezone,
        after: now,
      );
      store.updateAfterRun(id: task.id, ranAt: now, nextRunAt: next);
      stdout.writeln('Scheduler: recurring #${task.id} ran → next $next');
    } else {
      store.markDone(task.id, ranAt: now);
      stdout.writeln('Scheduler: one-shot #${task.id} done');
    }
  }

  Future<void> _notifyOwnerText(String text) async {
    final client = _client;
    if (client == null) {
      stdout.writeln('Scheduler owner notice (no client): $text');
      return;
    }
    try {
      final dm = await client.users.createDm(
        Snowflake.parse(services.config.ownerUserId),
      );
      await sendLongMessage(dm, text);
    } catch (error) {
      stderr.writeln('Could not DM owner: $error');
    }
  }

  Future<void> _notifyOwnerMissed(ScheduledTask task) async {
    // Best-effort DM to the owner. Failures are logged only — the channel
    // notice above is the primary signal.
    final client = _client;
    if (client == null) return;
    try {
      final dm = await client.users.createDm(
        Snowflake.parse(services.config.ownerUserId),
      );
      await sendLongMessage(
        dm,
        'Missed scheduled task #${task.id} in channel ${task.channelId}: '
        '${task.payload}',
      );
    } catch (error) {
      stderr.writeln('Could not DM owner about missed #${task.id}: $error');
    }
  }

  Future<void> _post(String channelId, String text) async {
    final client = _client;
    if (client == null) {
      stdout.writeln(
        'Scheduler (no Discord client): [$channelId] $text',
      );
      return;
    }
    try {
      final channel =
          client.channels[Snowflake.parse(channelId)] as PartialTextChannel;
      await sendLongMessage(channel, text);
      history.add(
        channelId,
        ChannelMessage(
          timestamp: DateTime.now(),
          authorId: client.user.id.toString(),
          authorName: 'Egon',
          content: text,
        ),
      );
    } catch (error) {
      stderr.writeln('Scheduler post to $channelId failed: $error');
      rethrow;
    }
  }
}
