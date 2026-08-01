import 'package:egon_bot/src/agent/tool_loop.dart';
import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:test/test.dart';

import 'helpers.dart';

final _initialMessages = [
  OllamaChatMessage(role: 'system', content: 'system'),
  OllamaChatMessage(role: 'user', content: 'question'),
];

void main() {
  group('runToolLoop', () {
    test('returns the reply once the model stops calling tools', () async {
      var rounds = 0;
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          rounds++;
          if (rounds == 1) {
            return OllamaChatMessage(
              role: 'assistant',
              content: '',
              toolCalls: [
                OllamaToolCall(name: 'stub_tool', arguments: const {}),
              ],
            );
          }
          return OllamaChatMessage(role: 'assistant', content: 'the answer');
        },
      );
      final stub = StubTool();
      final services = testServices(tools: [stub], ollama: ollama);

      final outcome = await runToolLoop(
        gate: services.llmGate,
        tier: ModelTier.big,
        registry: services.registry,
        context: contextFor(services, owner: true),
        initialMessages: _initialMessages,
      );

      expect(outcome.reply, 'the answer');
      expect(stub.executions, 1);
    });

    test('forces a final answer after maxRounds tool rounds', () async {
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          if (tools.isEmpty) {
            // The forced final round declares no tools.
            return OllamaChatMessage(role: 'assistant', content: 'forced');
          }
          return OllamaChatMessage(
            role: 'assistant',
            content: '',
            toolCalls: [
              OllamaToolCall(name: 'stub_tool', arguments: const {}),
            ],
          );
        },
      );
      final stub = StubTool();
      final services = testServices(tools: [stub], ollama: ollama);

      final outcome = await runToolLoop(
        gate: services.llmGate,
        tier: ModelTier.big,
        registry: services.registry,
        context: contextFor(services, owner: true),
        initialMessages: _initialMessages,
        maxRounds: 3,
      );

      expect(outcome.reply, 'forced');
      expect(stub.executions, 3);
      expect(ollama.chatCalls, 4, reason: '3 tool rounds + 1 forced final');
    });

    test('degraded turns can defer to the big model', () async {
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          expect(
            tools.map((t) => t.name),
            contains('defer_to_big_model'),
            reason: 'degraded turns must offer the defer tool',
          );
          return OllamaChatMessage(
            role: 'assistant',
            content: '',
            toolCalls: [
              OllamaToolCall(
                name: 'defer_to_big_model',
                arguments: const {'reason': 'needs research'},
              ),
            ],
          );
        },
      );
      final stub = StubTool();
      final services = testServices(tools: [stub], ollama: ollama);

      final outcome = await runToolLoop(
        gate: services.llmGate,
        tier: ModelTier.small,
        registry: services.registry,
        context: contextFor(services, owner: true),
        initialMessages: _initialMessages,
        degraded: true,
      );

      expect(outcome.deferredToBigModel, isTrue);
      expect(stub.executions, 0);
    });

    test('non-degraded turns do not offer the defer tool', () async {
      final ollama = FakeOllama(
        onChat: (messages, tools, modelOverride, format) async {
          expect(
              tools.map((t) => t.name), isNot(contains('defer_to_big_model')));
          return OllamaChatMessage(role: 'assistant', content: 'done');
        },
      );
      final services = testServices(tools: [StubTool()], ollama: ollama);

      final outcome = await runToolLoop(
        gate: services.llmGate,
        tier: ModelTier.big,
        registry: services.registry,
        context: contextFor(services, owner: true),
        initialMessages: _initialMessages,
      );
      expect(outcome.reply, 'done');
    });
  });
}
