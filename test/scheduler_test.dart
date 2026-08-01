import 'package:egon_bot/src/scheduler/task_store.dart';
import 'package:egon_bot/src/tools/builtin/cancel_scheduled_task_tool.dart';
import 'package:egon_bot/src/tools/builtin/schedule_task_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('TaskStore', () {
    test('creates one-shot and recurring tasks', () {
      final services = testServices(tools: []);
      final now = DateTime.utc(2026, 7, 30, 10);
      final oneShot = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'go to the mall',
        timezone: 'Europe/Berlin',
        dueAt: now.add(const Duration(days: 3)),
        now: now,
      );
      expect(oneShot.status, TaskStatus.pending);
      expect(oneShot.nextRunAt, now.add(const Duration(days: 3)));
      expect(oneShot.isRecurring, isFalse);

      final recurring = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'weekly ping',
        timezone: 'UTC',
        recurrence: '0 9 * * 1',
        now: now,
      );
      expect(recurring.isRecurring, isTrue);
      expect(recurring.nextRunAt.isAfter(now), isTrue);
    });

    test('rejects invalid schedules', () {
      final services = testServices(tools: []);
      final now = DateTime.utc(2026, 7, 30, 10);
      expect(
        () => services.tasks.create(
          createdBy: ownerId,
          channelId: '42',
          kind: TaskKind.message,
          payload: 'x',
          timezone: 'UTC',
          now: now,
        ),
        throwsArgumentError,
      );
      expect(
        () => services.tasks.create(
          createdBy: ownerId,
          channelId: '42',
          kind: TaskKind.message,
          payload: 'x',
          timezone: 'UTC',
          dueAt: now.subtract(const Duration(minutes: 1)),
          now: now,
        ),
        throwsArgumentError,
      );
      expect(
        () => services.tasks.create(
          createdBy: ownerId,
          channelId: '42',
          kind: TaskKind.message,
          payload: 'x',
          timezone: 'UTC',
          recurrence: 'not a cron',
          now: now,
        ),
        throwsFormatException,
      );
    });
  });

  group('Scheduler downtime policy', () {
    test('one-shot ≤6h late fires with delayed completion', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(tools: [], clock: () => now);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'tie your shoes',
        timezone: 'UTC',
        dueAt: now.subtract(const Duration(hours: 2)),
        now: now.subtract(const Duration(hours: 3)),
      );
      // Force next_run_at into the past (create() rejects past due_at, so
      // write it directly to simulate downtime).
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.subtract(const Duration(hours: 2)).toIso8601String(), task.id],
      );

      await services.scheduler.recoverOverdue(now: now);
      final after = services.tasks.byId(task.id)!;
      expect(after.status, TaskStatus.done);
      expect(after.lastRunAt, isNotNull);
    });

    test('one-shot >6h late is marked missed', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(tools: [], clock: () => now);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'old reminder',
        timezone: 'UTC',
        dueAt: now.add(const Duration(hours: 1)),
        now: now,
      );
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.subtract(const Duration(hours: 8)).toIso8601String(), task.id],
      );

      await services.scheduler.recoverOverdue(now: now);
      expect(services.tasks.byId(task.id)!.status, TaskStatus.missed);
    });

    test('recurring overdue skips to the next occurrence', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(tools: [], clock: () => now);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'every hour',
        timezone: 'UTC',
        recurrence: '0 * * * *',
        now: now.subtract(const Duration(days: 2)),
      );
      // Pretend we were down and next_run_at is stale.
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.subtract(const Duration(hours: 5)).toIso8601String(), task.id],
      );

      await services.scheduler.recoverOverdue(now: now);
      final after = services.tasks.byId(task.id)!;
      expect(after.status, TaskStatus.pending);
      expect(after.nextRunAt.isAfter(now), isTrue);
    });

    test('tick fires a due message task and marks it done', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(tools: [], clock: () => now);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'fire me',
        timezone: 'UTC',
        dueAt: now.add(const Duration(minutes: 1)),
        now: now,
      );
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.toIso8601String(), task.id],
      );

      await services.scheduler.tick(now: now);
      expect(services.tasks.byId(task.id)!.status, TaskStatus.done);
    });

    test('tick reschedules recurring message tasks', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(tools: [], clock: () => now);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'hourly',
        timezone: 'UTC',
        recurrence: '0 * * * *',
        now: now.subtract(const Duration(hours: 2)),
      );
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.toIso8601String(), task.id],
      );

      await services.scheduler.tick(now: now);
      final after = services.tasks.byId(task.id)!;
      expect(after.status, TaskStatus.pending);
      expect(after.nextRunAt.isAfter(now), isTrue);
      expect(after.lastRunAt, isNotNull);
    });

    test('agent tasks defer +5 min while GPU is busy', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final monitor = FakeMonitor()..userActive = true;
      final services = testServices(
        tools: [],
        monitor: monitor,
        clock: () => now,
      );
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.agent,
        payload: 'check the weather',
        timezone: 'UTC',
        dueAt: now.add(const Duration(minutes: 1)),
        now: now,
      );
      services.database.db.execute(
        'UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?',
        [now.toIso8601String(), task.id],
      );

      await services.scheduler.tick(now: now);
      final after = services.tasks.byId(task.id)!;
      expect(after.status, TaskStatus.pending);
      expect(
        after.nextRunAt,
        now.add(const Duration(minutes: 5)),
      );
    });
  });

  group('schedule tools', () {
    test('schedule_task + cancel_scheduled_task round trip', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(
        tools: [ScheduleTaskTool(), CancelScheduledTaskTool()],
        clock: () => now,
      );

      final created = await ScheduleTaskTool().execute(
        contextFor(services, owner: true),
        {
          'kind': 'message',
          'payload': 'Remind: mall',
          'due_at': now.add(const Duration(days: 3)).toIso8601String(),
        },
      );
      expect(created.isError, isFalse);
      final id = created.json['id'] as int;

      final cancelled = await CancelScheduledTaskTool().execute(
        contextFor(services, owner: true),
        {'id': id},
      );
      expect(cancelled.json['status'], 'cancelled');
      expect(services.tasks.byId(id)!.status, TaskStatus.cancelled);
    });

    test('non-owner cannot cancel someone else\'s task', () async {
      final now = DateTime.utc(2026, 7, 30, 12);
      final services = testServices(
        tools: [CancelScheduledTaskTool()],
        clock: () => now,
      );
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.message,
        payload: 'owner only',
        timezone: 'UTC',
        dueAt: now.add(const Duration(hours: 1)),
        now: now,
      );

      final result = await CancelScheduledTaskTool().execute(
        contextFor(services, owner: false),
        {'id': task.id},
      );
      expect(result.isError, isTrue);
      expect(services.tasks.byId(task.id)!.status, TaskStatus.pending);
    });
  });
}
