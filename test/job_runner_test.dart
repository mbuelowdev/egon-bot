import 'dart:convert';

import 'package:egon_bot/src/jobs/job_models.dart';
import 'package:egon_bot/src/jobs/planner.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/tools/builtin/start_job_tool.dart';
import 'package:test/test.dart';

import 'helpers.dart';

Future<Job> _waitForStatus(
  dynamic jobs,
  int id,
  String status, {
  Duration timeout = const Duration(seconds: 2),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    final job = jobs.byId(id) as Job;
    if (job.status == status) return job;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  final last = jobs.byId(id) as Job;
  fail('Job #$id stuck in ${last.status}, wanted $status. '
      'plan=${[for (final s in last.plan) '${s.index}:${s.status}']}');
}

void main() {
  group('JobPlanner.parsePlanResponse', () {
    test('parses title + steps', () {
      final planned = JobPlanner.parsePlanResponse(
        jsonEncode({
          'title': 'Wood sealing',
          'steps': ['Research methods', 'Find products', 'Write digest'],
        }),
        fallbackTitle: 'fallback',
      );
      expect(planned.title, 'Wood sealing');
      expect(planned.steps, hasLength(3));
      expect(planned.steps.first.index, 1);
      expect(planned.steps.first.description, 'Research methods');
    });

    test('strips markdown fences and enforces 2–10 steps', () {
      expect(
        () => JobPlanner.parsePlanResponse(
          '```json\n{"title":"t","steps":["only one"]}\n```',
          fallbackTitle: 'x',
        ),
        throwsFormatException,
      );

      final many = [
        for (var i = 0; i < 12; i++) 'step $i',
      ];
      final planned = JobPlanner.parsePlanResponse(
        jsonEncode({'title': 't', 'steps': many}),
        fallbackTitle: 'x',
      );
      expect(planned.steps, hasLength(10));
    });
  });

  group('JobRunner state machine', () {
    test('queued → planning → running → done', () async {
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          return OllamaChatMessage(
            role: 'assistant',
            content: 'step summary',
          );
        },
      );
      final services = testServices(
        tools: [],
        ollama: ollama,
        planner: FixedPlanner('Demo job', ['Do A', 'Do B']),
      );

      final job = services.jobRunner.enqueue(
        createdBy: ownerId,
        channelId: '42',
        instructions: 'Do the demo',
      );

      final done = await _waitForStatus(services.jobs, job.id, JobStatus.done);
      expect(done.plan.map((s) => s.status).toList(), ['done', 'done']);
      expect(done.result, contains('Demo job'));
    });

    test('cancel flag stops between steps', () async {
      var stepCalls = 0;
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          stepCalls++;
          await Future<void>.delayed(const Duration(milliseconds: 40));
          return OllamaChatMessage(
            role: 'assistant',
            content: 'findings $stepCalls',
          );
        },
      );
      final services = testServices(
        tools: [],
        ollama: ollama,
        planner: FixedPlanner('Long job', ['First', 'Second', 'Third']),
      );

      final job = services.jobRunner.enqueue(
        createdBy: ownerId,
        channelId: '42',
        instructions: 'long work',
      );

      await Future<void>.delayed(const Duration(milliseconds: 60));
      services.jobRunner.requestCancel(job.id);

      final after =
          await _waitForStatus(services.jobs, job.id, JobStatus.cancelled);
      expect(after.result, contains('Cancelled'));
      expect(stepCalls, lessThan(3));
    });

    test('ask_job_question parks in waiting_user; answer resumes', () async {
      var calls = 0;
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          calls++;
          if (calls == 1) {
            expect(tools.map((t) => t.name), contains('ask_job_question'));
            return OllamaChatMessage(
              role: 'assistant',
              content: '',
              toolCalls: [
                OllamaToolCall(
                  name: 'ask_job_question',
                  arguments: const {'question': 'Indoor or outdoor?'},
                ),
              ],
            );
          }
          return OllamaChatMessage(
            role: 'assistant',
            content: 'finished with answer',
          );
        },
      );
      final services = testServices(
        tools: [],
        ollama: ollama,
        planner: FixedPlanner('Needs input', ['Clarify scope', 'Finish']),
      );

      final job = services.jobRunner.enqueue(
        createdBy: ownerId,
        channelId: '42',
        instructions: 'seal wood',
      );
      final waiting =
          await _waitForStatus(services.jobs, job.id, JobStatus.waitingUser);
      expect(waiting.question, 'Indoor or outdoor?');

      services.jobRunner.answerWaitingJob(job.id, 'outdoor');
      final done = await _waitForStatus(services.jobs, job.id, JobStatus.done);
      expect(done.status, JobStatus.done);
      expect(calls, greaterThanOrEqualTo(2));
    });

    test('recover re-queues a running job and finishes the remaining step',
        () async {
      final ollama = FakeOllama(
        onChat: (m, t, o, f) async =>
            OllamaChatMessage(role: 'assistant', content: 'resumed step'),
      );
      final services = testServices(
        tools: [],
        ollama: ollama,
        planner: FixedPlanner('Interrupted', ['A', 'B']),
      );
      final job = services.jobs.create(
        createdBy: ownerId,
        channelId: '42',
        title: 'Interrupted',
        instructions: 'do stuff',
      );
      services.jobs.savePlanProgress(
        job.id,
        plan: [
          JobStep(index: 1, description: 'A', status: 'done', summary: 'ok'),
          JobStep(index: 2, description: 'B', status: 'pending'),
        ],
        currentStep: 2,
        status: JobStatus.running,
      );

      await services.jobRunner.recover();
      final after = await _waitForStatus(services.jobs, job.id, JobStatus.done);
      expect(after.progressLog, contains('resuming after restart'));
    });
  });

  group('start_job tool', () {
    test('enqueues and reports queue position', () async {
      final ollama = FakeOllama(
        onChat: (m, t, o, f) async {
          await Future<void>.delayed(const Duration(milliseconds: 150));
          return OllamaChatMessage(role: 'assistant', content: 'working');
        },
      );
      final services = testServices(
        tools: [StartJobTool()],
        ollama: ollama,
        planner: FixedPlanner('Slow', ['A', 'B']),
      );

      final first = await StartJobTool().execute(
        contextFor(services, owner: true),
        {'instructions': 'first job please'},
      );
      expect(first.isError, isFalse);

      await Future<void>.delayed(const Duration(milliseconds: 20));
      final second = await StartJobTool().execute(
        contextFor(services, owner: true),
        {'instructions': 'second job'},
      );
      expect(second.json['message'], contains('Queued behind'));
    });
  });
}
