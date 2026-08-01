import 'dart:async';

import 'package:egon_bot/src/llm/llm_gate.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:test/test.dart';

import 'helpers.dart';

final _messages = [OllamaChatMessage(role: 'user', content: 'hi')];

void main() {
  group('LlmGate', () {
    test('small tier runs immediately even while the GPU is busy', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..userActive = true;
      final gate = testGate(ollama: ollama, monitor: monitor);

      final reply = await gate
          .chat(tier: ModelTier.small, messages: _messages)
          .timeout(const Duration(seconds: 1));

      expect(reply.content, 'ok');
      expect(ollama.modelOverrides, ['small-model']);
    });

    test('big tier uses the default model when the GPU is free', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor();
      final gate = testGate(ollama: ollama, monitor: monitor);

      await gate
          .chat(tier: ModelTier.big, messages: _messages)
          .timeout(const Duration(seconds: 1));

      expect(ollama.modelOverrides, [null]);
    });

    test('big tier waits while user is active and resumes when free', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..userActive = true;
      final gate = testGate(ollama: ollama, monitor: monitor);

      final pending = gate.chat(tier: ModelTier.big, messages: _messages);

      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(ollama.chatCalls, 0, reason: 'must not run while GPU is busy');
      expect(gate.queuedBigJobs, 1);

      monitor.userActive = false;
      final reply = await pending.timeout(const Duration(seconds: 1));
      expect(reply.content, 'ok');
      expect(ollama.chatCalls, 1);
    });

    test('high average GPU load counts as busy', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..gpuAvg5m = 90;
      final gate = testGate(ollama: ollama, monitor: monitor);

      final pending = gate.chat(tier: ModelTier.big, messages: _messages);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(ollama.chatCalls, 0);

      monitor.gpuAvg5m = 10;
      await pending.timeout(const Duration(seconds: 1));
    });

    test('unreachable monitor counts as free (prefer big model)', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..unreachable = true;
      final gate = testGate(ollama: ollama, monitor: monitor);

      await gate
          .chat(tier: ModelTier.big, messages: _messages)
          .timeout(const Duration(seconds: 1));
      expect(ollama.chatCalls, 1);
      expect(await gate.isGpuFree(), isTrue);
    });

    test('chat requests enable think=high by default', () async {
      final ollama = FakeOllama();
      final gate = testGate(ollama: ollama, monitor: null);

      await gate.chat(tier: ModelTier.big, messages: _messages);
      await gate.chat(tier: ModelTier.small, messages: _messages);

      expect(ollama.thinkValues, ['high', 'high']);
    });

    test('no monitor configured means always free', () async {
      final ollama = FakeOllama();
      final gate = testGate(ollama: ollama, monitor: null);

      await gate
          .chat(tier: ModelTier.big, messages: _messages)
          .timeout(const Duration(seconds: 1));
      expect(ollama.chatCalls, 1);
    });

    test('queue cap rejects excess big jobs', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..userActive = true;
      final gate = testGate(ollama: ollama, monitor: monitor, queueCap: 1);

      final queued = gate.chat(tier: ModelTier.big, messages: _messages);
      expect(
        () => gate.chat(tier: ModelTier.big, messages: _messages),
        throwsA(isA<GateQueueFullException>()),
      );

      monitor.userActive = false;
      await queued.timeout(const Duration(seconds: 1));
    });

    test('expired jobs fail with GateTimeoutException', () async {
      final ollama = FakeOllama();
      final monitor = FakeMonitor()..userActive = true;
      final gate = testGate(
        ollama: ollama,
        monitor: monitor,
        interactiveTtl: Duration.zero,
      );

      await expectLater(
        gate
            .chat(tier: ModelTier.big, messages: _messages)
            .timeout(const Duration(seconds: 1)),
        throwsA(isA<GateTimeoutException>()),
      );
      expect(ollama.chatCalls, 0);
    });
  });
}
