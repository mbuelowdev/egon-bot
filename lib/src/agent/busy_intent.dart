import 'dart:io';

import '../jobs/job_models.dart';
import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../services.dart';

/// How to handle a follow-up while work is already in flight.
enum BusyFollowUpIntent {
  /// Stop the active job (owner only) / don't start a duplicate turn.
  cancel,

  /// Answer with a status snapshot; do not start a tool loop.
  status,

  /// Treat as new/amended work — proceed with (serialized) agent turn.
  proceed,
}

/// Classifies owner/user follow-ups while a job or chat turn is busy.
class BusyIntentClassifier {
  BusyIntentClassifier(this.services);

  final Services services;

  Future<BusyFollowUpIntent> classify({
    required String message,
    Job? activeJob,
    required bool chatTurnInFlight,
  }) async {
    if (!services.llmGate.hasUtilityTier) {
      return _heuristic(message);
    }
    try {
      final contextBits = <String>[
        if (activeJob != null)
          'There is an active job titled "${activeJob.title}".',
        if (chatTurnInFlight)
          'A chat reply/tool loop is still in progress in this channel.',
      ];
      final reply = await services.llmGate.chat(
        tier: ModelTier.small,
        messages: [
          OllamaChatMessage(
            role: 'system',
            content:
                'Reply with exactly one word: CANCEL, STATUS, or PROCEED.\n'
                '${contextBits.join(' ')}\n'
                'CANCEL = user wants to stop/abort/cancel the current work.\n'
                'STATUS = user only asks whether work is still running, for '
                'progress, or if you are done — not a new task.\n'
                'PROCEED = anything else (new task, amendment, clarification, '
                'unrelated question).',
          ),
          OllamaChatMessage(role: 'user', content: message),
        ],
      );
      final token = reply.content.trim().toUpperCase();
      if (token.startsWith('CANCEL')) return BusyFollowUpIntent.cancel;
      if (token.startsWith('STATUS')) return BusyFollowUpIntent.status;
      return BusyFollowUpIntent.proceed;
    } catch (error) {
      stderr.writeln('Busy-intent classification failed: $error');
      return _heuristic(message);
    }
  }

  BusyFollowUpIntent _heuristic(String message) {
    final lower = message.toLowerCase();
    if (RegExp(
      r'\b(stop|cancel|abort|halt|abbrechen|stopp|aufhören)\b',
    ).hasMatch(lower)) {
      return BusyFollowUpIntent.cancel;
    }
    if (RegExp(
      r'(noch\s+dran|noch\s+am|noch\s+beschäftigt|arbeitest\s+du\s+noch|'
      r'bist\s+du\s+noch|immer\s+noch|wie\s+weit|fertig\b|status\b|'
      r'was\s+machst\s+du|still\s+working|are\s+you\s+(still|done)|'
      r'how.?s\s+it\s+going|any\s+update|progress\b)',
    ).hasMatch(lower)) {
      return BusyFollowUpIntent.status;
    }
    return BusyFollowUpIntent.proceed;
  }
}

/// Short natural-language status for busy short-circuits (no tool loop).
String formatBusyStatusReply({
  Job? activeJob,
  required bool chatTurnInFlight,
}) {
  if (activeJob != null) {
    final plan = activeJob.plan;
    final step = activeJob.currentStep;
    if (step != null && plan.isNotEmpty) {
      final idx = (step - 1).clamp(0, plan.length - 1);
      final desc = plan[idx].description;
      return 'Still on it — **${activeJob.title}** is running '
          '(step $step/${plan.length}: $desc).';
    }
    return 'Still on it — **${activeJob.title}** '
        '(${activeJob.status}).';
  }
  if (chatTurnInFlight) {
    return 'Still working on your last request.';
  }
  return 'Nothing open right now.';
}

/// Lines injected into the system prompt under "Currently working on".
String renderActiveWorkLines({
  Job? activeJob,
  required String channelId,
  required bool chatTurnInFlight,
}) {
  final lines = <String>[];
  if (activeJob != null) {
    final sameChannel = activeJob.channelId == channelId;
    final where = sameChannel ? 'in this channel' : 'in another channel';
    final step = activeJob.currentStep;
    final stepBit = (step != null && activeJob.plan.isNotEmpty)
        ? ', step $step/${activeJob.plan.length}'
        : '';
    lines.add(
      '- Active job #${activeJob.id} "${activeJob.title}" '
      '(${activeJob.status}$stepBit) $where.',
    );
  }
  if (chatTurnInFlight) {
    lines.add('- A chat tool-loop is already in flight in this channel.');
  }
  if (lines.isEmpty) {
    return '(nothing currently running)';
  }
  return lines.join('\n');
}
