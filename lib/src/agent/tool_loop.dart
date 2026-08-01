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

/// Job-step-only tool: park the job and ask the owner a clarifying question.
const askJobQuestionTool = OllamaTool(
  name: 'ask_job_question',
  description:
      'Pause this job and ask the owner a clarifying question in the channel. '
      'Use only when you cannot continue the current step without their input '
      '(missing detail, ambiguous choice). Do not use for progress updates.',
  parameters: {
    'type': 'object',
    'properties': {
      'question': {
        'type': 'string',
        'description': 'The question to post to the owner.',
      },
    },
    'required': ['question'],
  },
);

class ToolLoopOutcome {
  ToolLoopOutcome.reply(this.reply)
      : deferredToBigModel = false,
        cancelled = false,
        question = null;

  ToolLoopOutcome.deferred()
      : reply = '',
        deferredToBigModel = true,
        cancelled = false,
        question = null;

  ToolLoopOutcome.cancelled({this.reply = ''})
      : deferredToBigModel = false,
        cancelled = true,
        question = null;

  ToolLoopOutcome.needsInput(this.question)
      : reply = '',
        deferredToBigModel = false,
        cancelled = false;

  final String reply;
  final bool deferredToBigModel;
  final bool cancelled;
  final String? question;
}

/// Runs a bounded model <-> tool conversation until the model returns a
/// final reply with no further tool calls, or [maxRounds] is exhausted, in
/// which case one final tools-disabled round is forced so the user always
/// gets an answer.
///
/// [extraTools] / handling for [askJobQuestionTool] and [shouldAbort] support
/// long-running jobs (§9): cancel between tool calls, and park on questions.
Future<ToolLoopOutcome> runToolLoop({
  required LlmGate gate,
  required ModelTier tier,
  required ToolRegistry registry,
  required ToolContext context,
  required List<OllamaChatMessage> initialMessages,
  bool degraded = false,
  bool enableAskJobQuestion = false,
  Future<bool> Function()? shouldAbort,
  int maxRounds = 20,
}) async {
  final messages = List<OllamaChatMessage>.of(initialMessages);
  final tools = [
    ...registry.schemasFor(context),
    if (degraded) deferToBigModelTool,
    if (enableAskJobQuestion) askJobQuestionTool,
  ];

  for (var round = 0; round < maxRounds; round++) {
    if (shouldAbort != null && await shouldAbort()) {
      return ToolLoopOutcome.cancelled();
    }

    final assistant = await gate.chat(
      tier: tier,
      messages: messages,
      tools: tools,
      originChannelId: context.channelId,
    );

    if (shouldAbort != null && await shouldAbort()) {
      return ToolLoopOutcome.cancelled(
        reply: assistant.content.trim(),
      );
    }

    if (assistant.toolCalls.isEmpty) {
      return ToolLoopOutcome.reply(assistant.content.trim());
    }

    messages.add(assistant);

    for (final call in assistant.toolCalls) {
      if (degraded && call.name == deferToBigModelTool.name) {
        return ToolLoopOutcome.deferred();
      }
      if (enableAskJobQuestion && call.name == askJobQuestionTool.name) {
        final q = (call.arguments['question'] as String?)?.trim() ?? '';
        if (q.isEmpty) {
          messages.add(
            OllamaChatMessage(
              role: 'tool',
              content: jsonEncode({'error': 'question must not be empty'}),
              toolCallId: call.id,
              name: call.name,
            ),
          );
          continue;
        }
        return ToolLoopOutcome.needsInput(q);
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

      if (shouldAbort != null && await shouldAbort()) {
        return ToolLoopOutcome.cancelled();
      }
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
    originChannelId: context.channelId,
  );
  return ToolLoopOutcome.reply(finalAssistant.content.trim());
}
