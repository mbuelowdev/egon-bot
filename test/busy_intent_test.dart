import 'dart:async';

import 'package:egon_bot/src/agent/busy_intent.dart';
import 'package:egon_bot/src/agent/prompts.dart';
import 'package:egon_bot/src/discord/channel_turn_queue.dart';
import 'package:egon_bot/src/jobs/job_models.dart';
import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('BusyIntentClassifier heuristic', () {
    late BusyIntentClassifier classifier;

    setUp(() {
      // No utility model → keyword path only.
      final services = testServices(tools: [], utilityModel: null);
      classifier = BusyIntentClassifier(services);
    });

    test('detects cancel', () async {
      expect(
        await classifier.classify(
          message: 'stopp den job bitte',
          activeJob: null,
          chatTurnInFlight: true,
        ),
        BusyFollowUpIntent.cancel,
      );
    });

    test('detects status pings', () async {
      for (final msg in [
        'bist du noch dran?',
        'noch am arbeiten?',
        'are you still working?',
        'Status?',
        'fertig?',
      ]) {
        expect(
          await classifier.classify(
            message: msg,
            activeJob: null,
            chatTurnInFlight: true,
          ),
          BusyFollowUpIntent.status,
          reason: msg,
        );
      }
    });

    test('defaults to proceed', () async {
      expect(
        await classifier.classify(
          message: 'such bitte auch nach Acryl statt Öl',
          activeJob: null,
          chatTurnInFlight: true,
        ),
        BusyFollowUpIntent.proceed,
      );
    });
  });

  group('BusyIntentClassifier LLM', () {
    test('parses STATUS from utility model', () async {
      final ollama = FakeOllama(
        onChat: (m, t, o, f) async =>
            OllamaChatMessage(role: 'assistant', content: 'STATUS'),
      );
      final services = testServices(
        tools: [],
        ollama: ollama,
        utilityModel: 'tiny',
      );
      final intent = await BusyIntentClassifier(services).classify(
        message: 'wie siehts aus?',
        activeJob: null,
        chatTurnInFlight: true,
      );
      expect(intent, BusyFollowUpIntent.status);
      expect(ollama.chatCalls, 1);
    });
  });

  group('formatBusyStatusReply', () {
    test('includes job step when available', () {
      final job = Job(
        id: 7,
        createdAt: DateTime.utc(2026),
        createdBy: ownerId,
        channelId: '42',
        title: 'Holz versiegeln',
        instructions: 'research',
        plan: [
          JobStep(index: 1, description: 'Methoden', status: 'done'),
          JobStep(index: 2, description: 'Produkte finden', status: 'running'),
        ],
        currentStep: 2,
        status: JobStatus.running,
        question: null,
        progressLog: null,
        result: null,
        priority: 0,
        updatedAt: DateTime.utc(2026),
      );
      final text = formatBusyStatusReply(
        activeJob: job,
        chatTurnInFlight: false,
      );
      expect(text, contains('Holz versiegeln'));
      expect(text, contains('2/2'));
      expect(text, contains('Produkte finden'));
    });

    test('mentions in-flight chat turn', () {
      expect(
        formatBusyStatusReply(activeJob: null, chatTurnInFlight: true),
        contains('letzten Anfrage'),
      );
    });
  });

  group('renderActiveWorkLines', () {
    test('reports idle when nothing running', () {
      expect(
        renderActiveWorkLines(
          activeJob: null,
          channelId: '1',
          chatTurnInFlight: false,
        ),
        '(nothing currently running)',
      );
    });

    test('is injected into group system prompt', () {
      final prompt = buildGroupSystemPrompt(
        memoryLines: '(none)',
        localNow: 'now',
        activeWorkLines: '- Active job #1 "Demo" (running) in this channel.',
      );
      expect(prompt, contains('## Currently working on'));
      expect(prompt, contains('Active job #1'));
      expect(prompt, contains('nicht erneut mit Tools'));
    });
  });

  group('ChannelTurnQueue', () {
    test('serializes turns on the same channel', () async {
      final queue = ChannelTurnQueue();
      final order = <int>[];
      final firstStarted = Completer<void>();
      final releaseFirst = Completer<void>();

      final a = queue.enqueue('c1', () async {
        order.add(1);
        firstStarted.complete();
        await releaseFirst.future;
        order.add(2);
      });
      final b = queue.enqueue('c1', () async {
        order.add(3);
      });

      await firstStarted.future;
      expect(queue.isBusy('c1'), isTrue);
      expect(order, [1]);

      releaseFirst.complete();
      await Future.wait([a, b]);
      expect(order, [1, 2, 3]);
      expect(queue.isBusy('c1'), isFalse);
    });

    test('allows parallel turns on different channels', () async {
      final queue = ChannelTurnQueue();
      final gate = Completer<void>();
      var aEntered = false;
      var bEntered = false;

      final a = queue.enqueue('a', () async {
        aEntered = true;
        await gate.future;
      });
      final b = queue.enqueue('b', () async {
        bEntered = true;
        await gate.future;
      });

      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(aEntered, isTrue);
      expect(bEntered, isTrue);
      gate.complete();
      await Future.wait([a, b]);
    });
  });
}
