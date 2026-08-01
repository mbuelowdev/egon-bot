import 'dart:async';
import 'dart:io';

import 'package:nyxx/nyxx.dart';

import '../agent/context_builder.dart';
import '../agent/tool_loop.dart';
import '../discord/discord_actions.dart';
import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../services.dart';
import '../tools/tool.dart';
import 'job_models.dart';
import 'job_store.dart';
import 'planner.dart';

/// Singleton sequential worker for long-running jobs (ARCHITECTURE.md §9).
///
/// One job is active at a time (`planning`/`running`); others wait in
/// `queued`. Cancellation is checked between tool calls and steps. Owner
/// clarifying answers re-queue a `waiting_user` job at the front.
class JobRunner {
  JobRunner({
    required this.services,
    required this.store,
    required this.history,
    JobPlanner? planner,
  }) : _planner = planner ?? JobPlanner(services.llmGate);

  final Services services;
  final JobStore store;
  final ChannelHistoryStore history;
  final JobPlanner _planner;

  NyxxGateway? _client;
  bool _pumping = false;
  final Set<int> _cancelRequested = {};

  /// Pending owner answers keyed by job id (injected when the step resumes).
  final Map<int, String> _pendingAnswers = {};

  void attachClient(NyxxGateway client) {
    _client = client;
  }

  void detachClient() {
    _client = null;
  }

  /// Boot / reconnect: restart any `running`/`planning` job; leave
  /// `queued`/`waiting_user` alone (§9 outage recovery).
  Future<void> recover() async {
    final active = store.activeJob();
    if (active != null) {
      final step = active.currentStep ?? 1;
      final total = active.plan.isEmpty ? '?' : '${active.plan.length}';
      store.appendLog(active.id, 'resuming after restart at step $step');
      // Prefer this job next (also sets status back to queued).
      store.requeueAtFront(active.id);
      await _post(
        active.channelId,
        'Back online, resuming **${active.title}** at step $step/$total.',
      );
    }
    kick();
  }

  /// Wake the worker if idle.
  void kick() {
    if (_pumping) return;
    unawaited(_pump());
  }

  /// Enqueue a new job and start the worker. Returns the created row.
  Job enqueue({
    required String createdBy,
    required String channelId,
    required String instructions,
    String? titleHint,
  }) {
    final title = (titleHint?.trim().isNotEmpty ?? false)
        ? titleHint!.trim()
        : _shortTitle(instructions);
    final job = store.create(
      createdBy: createdBy,
      channelId: channelId,
      title: title,
      instructions: instructions,
    );
    kick();
    return job;
  }

  void requestCancel(int jobId) {
    _cancelRequested.add(jobId);
    final job = store.byId(jobId);
    if (job != null &&
        (job.status == JobStatus.queued ||
            job.status == JobStatus.waitingUser)) {
      unawaited(_finalizeCancelled(job));
    }
  }

  bool isCancelRequested(int jobId) => _cancelRequested.contains(jobId);

  /// Owner answered a `waiting_user` question — re-queue at front with answer.
  void answerWaitingJob(int jobId, String answer) {
    _pendingAnswers[jobId] = answer;
    store.requeueAtFront(jobId);
    store.appendLog(jobId, 'owner answered: ${_clip(answer, 200)}');
    kick();
  }

  /// Utility-model classification: is [message] a cancel request for [job]?
  Future<bool> classifyCancelIntent(Job job, String message) async {
    if (!services.llmGate.hasUtilityTier) {
      // Fall back to a cheap keyword heuristic when no utility model.
      final lower = message.toLowerCase();
      return RegExp(
            r'\b(stop|cancel|abort|halt|abbrechen|stopp|aufhören)\b',
          ).hasMatch(lower) &&
          (lower.contains(job.title.toLowerCase()) ||
              lower.contains('job') ||
              lower.contains('research') ||
              lower.contains('recherch'));
    }
    try {
      final reply = await services.llmGate.chat(
        tier: ModelTier.small,
        messages: [
          OllamaChatMessage(
            role: 'system',
            content:
                'Reply with exactly YES or NO. Is the user asking to cancel, '
                'stop, or abort the running job titled "${job.title}"?',
          ),
          OllamaChatMessage(role: 'user', content: message),
        ],
      );
      return reply.content.trim().toUpperCase().startsWith('YES');
    } catch (error) {
      stderr.writeln('Cancel classification failed: $error');
      return false;
    }
  }

  Future<void> _pump() async {
    if (_pumping) return;
    _pumping = true;
    try {
      while (true) {
        if (store.activeJob() != null) return;
        final next = store.nextQueued();
        if (next == null) return;
        await _runJob(next.id);
      }
    } finally {
      _pumping = false;
      // A kick may have arrived while we were finishing.
      if (store.activeJob() == null && store.nextQueued() != null) {
        unawaited(_pump());
      }
    }
  }

  Future<void> _runJob(int jobId) async {
    final queued = store.byId(jobId);
    if (queued == null || queued.status != JobStatus.queued) return;

    if (_cancelRequested.remove(jobId)) {
      await _finalizeCancelled(queued);
      return;
    }

    // Claim before any await so two pumps cannot run the same job.
    final hasPlan = queued.plan.isNotEmpty;
    final claimed = store.claimQueued(
      jobId,
      nextStatus: hasPlan ? JobStatus.running : JobStatus.planning,
    );
    if (claimed == null) return;

    try {
      // Planning (skip if we already have a plan from a prior resume).
      if (!hasPlan) {
        store.appendLog(jobId, 'planning');
        await _post(claimed.channelId, 'Planning **${claimed.title}**…');

        if (_cancelRequested.contains(jobId)) {
          await _finalizeCancelled(store.byId(jobId)!);
          return;
        }

        final planned = await _planner.plan(claimed.instructions);
        store.savePlanProgress(
          jobId,
          plan: planned.steps,
          currentStep: 1,
          status: JobStatus.running,
          title: planned.title,
          appendLog: 'plan ready (${planned.steps.length} steps)',
        );
        final plannedJob = store.byId(jobId);
        if (plannedJob == null) return;
        await _post(
          plannedJob.channelId,
          _formatPlanMessage(plannedJob.title, plannedJob.plan),
        );
      } else {
        store.appendLog(jobId, 'running');
      }

      var current = store.byId(jobId);
      if (current == null) return;
      final planLength = current.plan.length;
      final startIndex = (current.currentStep ?? 1).clamp(1, planLength);

      for (var i = startIndex; i <= planLength; i++) {
        current = store.byId(jobId);
        if (current == null) return;
        if (_cancelRequested.contains(jobId) ||
            current.status == JobStatus.cancelled) {
          await _finalizeCancelled(current);
          return;
        }

        final step = current.plan[i - 1];
        step.status = 'running';
        store.savePlanProgress(
          jobId,
          plan: current.plan,
          currentStep: i,
          status: JobStatus.running,
          appendLog: 'step $i/$planLength: ${step.description}',
        );

        // Note GPU waits in the log when the gate is busy (big-tier calls
        // will block inside the tool loop until free).
        if (!await services.llmGate.isGpuFree()) {
          store.appendLog(jobId, 'waiting for GPU');
        }

        final answer = _pendingAnswers.remove(jobId);
        final outcome = await _runStep(current, step, ownerAnswer: answer);

        current = store.byId(jobId);
        if (current == null) return;
        if (outcome.cancelled || _cancelRequested.contains(jobId)) {
          if (outcome.reply.isNotEmpty) {
            step.summary = outcome.reply;
            step.status = 'done';
          } else {
            step.status = 'skipped';
          }
          store.savePlanProgress(
            jobId,
            plan: current.plan,
            currentStep: i,
            status: JobStatus.running,
          );
          await _finalizeCancelled(store.byId(jobId)!);
          return;
        }

        if (outcome.question != null) {
          step.status = 'pending';
          store.savePlanProgress(
            jobId,
            plan: current.plan,
            currentStep: i,
            status: JobStatus.waitingUser,
            question: outcome.question,
            appendLog: 'waiting_user: ${outcome.question}',
          );
          await _post(
            current.channelId,
            'Need your input for **${current.title}** (step $i/'
            '$planLength):\n${outcome.question}',
          );
          return; // pump may start the next queued job
        }

        step.status = 'done';
        step.summary =
            outcome.reply.isEmpty ? '(no summary)' : _clip(outcome.reply, 1500);
        store.savePlanProgress(
          jobId,
          plan: current.plan,
          currentStep: i,
          status: JobStatus.running,
          appendLog: 'step $i done',
        );

        if (planLength > 2) {
          await _post(
            current.channelId,
            'Step $i/$planLength done — ${_clip(step.summary!, 280)}',
          );
        }
      }

      current = store.byId(jobId);
      if (current == null) return;
      for (final s in current.plan) {
        if (s.status == 'running' || s.status == 'pending') {
          s.status = 'done';
        }
      }
      final digest = _buildDigest(current);
      store.savePlanProgress(
        jobId,
        plan: current.plan,
        currentStep: current.plan.length,
        status: JobStatus.done,
        result: digest,
        appendLog: 'done',
        priority: 0,
      );
      await _post(current.channelId, digest);
    } catch (error, stackTrace) {
      stderr.writeln('Job #$jobId failed: $error\n$stackTrace');
      store.savePlanProgress(
        jobId,
        plan: store.byId(jobId)?.plan ?? const [],
        currentStep: store.byId(jobId)?.currentStep,
        status: JobStatus.failed,
        appendLog: 'failed: $error',
      );
      final job = store.byId(jobId);
      if (job != null) {
        await _post(
          job.channelId,
          'Job **${job.title}** failed: $error',
        );
      }
    } finally {
      _cancelRequested.remove(jobId);
    }
  }

  Future<ToolLoopOutcome> _runStep(
    Job job,
    JobStep step, {
    String? ownerAnswer,
  }) async {
    final prior = [
      for (final s in job.plan)
        if (s.status == 'done' && s.summary != null)
          'Step ${s.index}: ${s.summary}',
    ].join('\n');

    final answerBlock = ownerAnswer == null
        ? ''
        : '\n\nThe owner answered your earlier question:\n"""$ownerAnswer"""\n'
            'Continue the step with that information.';

    final isDm = !services.config.allowedChannelIds.contains(job.channelId);
    final context = ToolContext(
      channelId: job.channelId,
      userId: job.createdBy,
      isOwner: job.createdBy == services.config.ownerUserId,
      isDm: isDm,
      services: services,
    );

    final system = '''
You are Egon executing one step of a longer job.
Job: ${job.title}
Original request: ${job.instructions}

Prior step summaries:
${prior.isEmpty ? '(none yet)' : prior}

Current step (${step.index}/${job.plan.length}): ${step.description}

Do the work for this step using tools when needed. When finished, reply with a
concise summary of what you found/did for this step (no meta chatter). If you
truly cannot continue without the owner, call ask_job_question.
$answerBlock
''';

    return runToolLoop(
      gate: services.llmGate,
      tier: ModelTier.big,
      registry: services.registry,
      context: context,
      initialMessages: [
        OllamaChatMessage(role: 'system', content: system),
        OllamaChatMessage(
          role: 'user',
          content: 'Execute step ${step.index}: ${step.description}',
        ),
      ],
      enableAskJobQuestion: true,
      shouldAbort: () async => _cancelRequested.contains(job.id),
      maxRounds: 15,
    );
  }

  Future<void> _finalizeCancelled(Job job) async {
    _cancelRequested.remove(job.id);
    // Reload so summaries persisted by the just-finished step are included.
    final latest = store.byId(job.id) ?? job;
    final partial = [
      for (final s in latest.plan)
        if (s.summary != null &&
            s.summary!.isNotEmpty &&
            s.summary != '(no summary)')
          '• Step ${s.index}: ${_clip(s.summary!, 400)}',
    ].join('\n');
    final text = partial.isEmpty
        ? 'Cancelled **${latest.title}**. No findings yet.'
        : 'Cancelled **${latest.title}**. Partial findings:\n$partial';
    store.savePlanProgress(
      latest.id,
      plan: latest.plan,
      currentStep: latest.currentStep,
      status: JobStatus.cancelled,
      result: text,
      appendLog: 'cancelled',
      priority: 0,
    );
    await _post(latest.channelId, text);
  }

  String _formatPlanMessage(String title, List<JobStep> plan) {
    final lines = [
      for (final s in plan) '${s.index}. ${s.description}',
    ].join('\n');
    return "Here's my plan for **$title**:\n$lines\n\nSay stop anytime.";
  }

  String _buildDigest(Job job) {
    final parts = <String>[
      '**${job.title}** — done.',
      for (final s in job.plan)
        if (s.summary != null) '**${s.index}. ${s.description}**\n${s.summary}',
    ];
    var digest = parts.join('\n\n');
    if (digest.length > discordMessageLimit) {
      digest = '${digest.substring(0, discordMessageLimit - 20)}\n…[truncated]';
    }
    return digest;
  }

  Future<void> _post(String channelId, String text) async {
    final client = _client;
    if (client == null) {
      stdout.writeln('JobRunner (no Discord client): [$channelId] $text');
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
      stderr.writeln('JobRunner post to $channelId failed: $error');
    }
  }

  static String _shortTitle(String instructions) {
    final line = instructions.trim().split(RegExp(r'\s*\n\s*')).first;
    if (line.isEmpty) return 'Untitled job';
    return line.length <= 60 ? line : '${line.substring(0, 57)}...';
  }

  static String _clip(String s, int max) =>
      s.length <= max ? s : '${s.substring(0, max - 1)}…';
}
