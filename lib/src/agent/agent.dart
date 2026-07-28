import 'dart:async';
import 'dart:io';

import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../services.dart';
import '../tools/tool.dart';
import 'context_builder.dart';
import 'prompts.dart';
import 'tool_loop.dart';

/// A message the router decided the bot should respond to.
class IncomingMessage {
  IncomingMessage({
    required this.channelId,
    required this.authorId,
    required this.authorName,
    required this.content,
    required this.timestamp,
    required this.isDm,
  });

  final String channelId;
  final String authorId;
  final String authorName;
  final String content;
  final DateTime timestamp;
  final bool isDm;
}

/// One conversational turn: context -> tier decision -> tool loop -> reply
/// (ARCHITECTURE.md §5.1, §6).
class Agent {
  Agent({required this.services, required this.history});

  final Services services;
  final ChannelHistoryStore history;

  Future<void> handleMessage(
    IncomingMessage message,
    Future<void> Function(String text) send,
  ) async {
    final gate = services.llmGate;
    final context = ToolContext(
      channelId: message.channelId,
      userId: message.authorId,
      isOwner: message.authorId == services.config.ownerUserId,
      services: services,
    );

    final gpuFree = await gate.isGpuFree();
    if (!gpuFree && !gate.hasUtilityTier) {
      await send('Die GPU ist gerade in Benutzung — versuch es später '
          'nochmal.');
      return;
    }
    final degraded = !gpuFree;

    final initialMessages = _buildTurnMessages(
      message,
      context,
      degraded: degraded,
    );

    try {
      final outcome = await runToolLoop(
        gate: gate,
        tier: degraded ? ModelTier.small : ModelTier.big,
        registry: services.registry,
        context: context,
        initialMessages: initialMessages,
        degraded: degraded,
      );

      if (outcome.deferredToBigModel) {
        await send(
          'Die GPU ist gerade belegt — ich hab die Anfrage eingereiht und '
          'melde mich hier, sobald sie durch ist.',
        );
        unawaited(_runDeferredBigTurn(message, context, send));
        return;
      }

      if (outcome.reply.isNotEmpty) {
        await send(outcome.reply);
      }
    } on GateQueueFullException {
      await send('Bei mir stapeln sich gerade die Anfragen — versuch es '
          'gleich nochmal.');
    } catch (error, stackTrace) {
      stderr.writeln('Agent turn failed: $error\n$stackTrace');
      await send('Ich komme gerade nicht an mein Gehirn (Ollama). Versuch es '
          'später nochmal.');
    }
  }

  /// Re-runs the turn on the big model after a degraded-mode deferral. The
  /// gate queues it until the GPU frees up; the answer is posted whenever
  /// that happens.
  Future<void> _runDeferredBigTurn(
    IncomingMessage message,
    ToolContext context,
    Future<void> Function(String text) send,
  ) async {
    final initialMessages = _buildTurnMessages(
      message,
      context,
      degraded: false,
    );
    try {
      final outcome = await runToolLoop(
        gate: services.llmGate,
        tier: ModelTier.big,
        registry: services.registry,
        context: context,
        initialMessages: initialMessages,
      );
      if (outcome.reply.isNotEmpty) {
        await send('${message.authorName}: ${outcome.reply}');
      }
    } on GateTimeoutException {
      await send(
        'Sorry ${message.authorName} — die GPU war zu lange belegt, deine '
        'eingereihte Anfrage ist verfallen. Stell sie gerne nochmal.',
      );
    } catch (error, stackTrace) {
      stderr.writeln('Deferred big turn failed: $error\n$stackTrace');
    }
  }

  List<OllamaChatMessage> _buildTurnMessages(
    IncomingMessage message,
    ToolContext context, {
    required bool degraded,
  }) {
    final timestamps = services.timestamps;
    final historyLines = renderHistoryLines(
      history.recent(message.channelId),
      timestamps: timestamps,
    );
    final localNow = timestamps.now();

    final systemPrompt = message.isDm
        ? buildDmSystemPrompt(
            authorName: message.authorName,
            isOwner: context.isOwner,
            historyLines: historyLines,
            localNow: localNow,
            degraded: degraded,
          )
        : buildGroupSystemPrompt(
            historyLines: historyLines,
            localNow: localNow,
            degraded: degraded,
          );

    final userContent = buildUserMessage(
      localTimestamp: timestamps.format(message.timestamp),
      authorName: message.authorName,
      content: message.content,
    );

    return [
      OllamaChatMessage(role: 'system', content: systemPrompt),
      OllamaChatMessage(role: 'user', content: userContent),
    ];
  }
}
