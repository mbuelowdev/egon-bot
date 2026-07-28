import 'dart:convert';
import 'dart:io';

import '../llm/llm_gate.dart';
import '../llm/ollama_models.dart';
import '../tools/tool.dart';
import '../tools/tool_registry.dart';

/// Special tool only declared in degraded (CPU) turns: the small model calls
/// it to hand the request over to the big-model queue (§5.1).
const deferToBigModelTool = OllamaTool(
  name: 'defer_to_big_model',
  description:
      'Hand this request over to the powerful model once the GPU is free. '
      'Call this when the request needs deep reasoning, long-form writing, '
      'thorough research, or you are not confident you can answer it well. '
      'Do not call it for simple questions you can answer yourself.',
  parameters: {
    'type': 'object',
    'properties': {
      'reason': {
        'type': 'string',
        'description': 'Short reason why the big model is needed.',
      },
    },
  },
);

class ToolLoopOutcome {
  ToolLoopOutcome.reply(this.reply) : deferredToBigModel = false;
  ToolLoopOutcome.deferred()
      : reply = '',
        deferredToBigModel = true;

  final String reply;
  final bool deferredToBigModel;
}

/// Runs a bounded model <-> tool conversation until the model returns a
/// final reply with no further tool calls, or [maxRounds] is exhausted, in
/// which case one final tools-disabled round is forced so the user always
/// gets an answer.
Future<ToolLoopOutcome> runToolLoop({
  required LlmGate gate,
  required ModelTier tier,
  required ToolRegistry registry,
  required ToolContext context,
  required List<OllamaChatMessage> initialMessages,
  bool degraded = false,
  int maxRounds = 20,
}) async {
  final messages = List<OllamaChatMessage>.of(initialMessages);
  final tools = [
    ...registry.schemasFor(context),
    if (degraded) deferToBigModelTool,
  ];

  for (var round = 0; round < maxRounds; round++) {
    final assistant = await gate.chat(
      tier: tier,
      messages: messages,
      tools: tools,
    );

    if (assistant.toolCalls.isEmpty) {
      return ToolLoopOutcome.reply(assistant.content.trim());
    }

    messages.add(assistant);

    for (final call in assistant.toolCalls) {
      if (degraded && call.name == deferToBigModelTool.name) {
        return ToolLoopOutcome.deferred();
      }

      stdout.writeln(
        'Tool call round ${round + 1}: '
        '${call.name}(${jsonEncode(call.arguments)})',
      );
      final result = await registry.dispatch(context, call);
      messages.add(
        OllamaChatMessage(
          role: 'tool',
          content: jsonEncode(result.json),
          toolCallId: call.id,
          name: call.name,
        ),
      );
    }
  }

  // Tool budget exhausted: force a final, tools-disabled answer.
  messages.add(
    OllamaChatMessage(
      role: 'system',
      content:
          'Tool budget for this turn is exhausted. Answer now with what you '
          'already know, in the same language as the user, without meta '
          'commentary.',
    ),
  );
  final finalAssistant = await gate.chat(
    tier: tier,
    messages: messages,
    tools: const [],
  );
  return ToolLoopOutcome.reply(finalAssistant.content.trim());
}
