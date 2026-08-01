import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/scheduler/task_store.dart';
import 'package:egon_bot/src/scheduler/watch_spec.dart';
import 'package:egon_bot/src/scheduler/watcher.dart';
import 'package:egon_bot/src/tools/builtin/http_request_tool.dart';
import 'package:egon_bot/src/tools/builtin/watch_url_tool.dart';
import 'package:egon_bot/src/web/fetch_api.dart';
import 'package:egon_bot/src/web/ssrf_guard.dart';
import 'package:test/test.dart';

import 'helpers.dart';

class StubFetchApi extends FetchApi {
  StubFetchApi(this.responses);

  /// Successive texts returned for any URL. Throws [Exception] entries.
  final List<Object> responses;
  int calls = 0;

  @override
  Future<FetchedPage> fetch(String url) async {
    if (calls >= responses.length) {
      throw StateError(
          'StubFetchApi exhausted (${responses.length} responses)');
    }
    final next = responses[calls++];
    if (next is Exception) throw next;
    final text = next as String;
    return FetchedPage(
      url: url,
      title: 'stub',
      text: text,
      contentType: 'text/html',
      truncated: false,
    );
  }
}

void main() {
  group('SSRF guard', () {
    test('blocks loopback and private IPv4 literals', () async {
      for (final host in [
        '127.0.0.1',
        '10.1.2.3',
        '192.168.1.1',
        '172.16.0.1',
        '169.254.1.1',
        '100.64.0.1',
      ]) {
        await expectLater(
          assertPublicHttpUri(Uri.parse('http://$host/x')),
          throwsA(isA<SsrfBlockedException>()),
        );
      }
    });

    test('blocks localhost hostname without DNS', () async {
      await expectLater(
        assertPublicHttpUri(Uri.parse('http://localhost/')),
        throwsA(isA<SsrfBlockedException>()),
      );
    });

    test('rejects non-http schemes', () async {
      await expectLater(
        assertPublicHttpUri(Uri.parse('file:///etc/passwd')),
        throwsA(isA<SsrfBlockedException>()),
      );
    });
  });

  group('watch interval helpers', () {
    test('parses minutes/hours and enforces minimum', () {
      expect(parseWatchInterval('15m').minutes, 15);
      expect(parseWatchInterval('1h').cron, '0 * * * *');
      expect(
        () => parseWatchInterval('5m'),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('Watcher', () {
    test('stores first snapshot without alerting', () async {
      final fetch = StubFetchApi(['Tickets coming soon']);
      final services = testServices(tools: [], fetchApi: fetch);
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.watch,
        payload: WatchSpec(
          url: 'https://example.com/tickets',
          condition: 'tickets are on sale',
          intervalMinutes: 15,
          untilTriggered: true,
        ).encode(),
        timezone: 'UTC',
        recurrence: '*/15 * * * *',
        stateJson: WatchState().encode(),
      );

      final result = await Watcher(services).run(task);
      expect(result.alert, isNull);
      expect(result.done, isFalse);
      expect(result.state.hash, isNotNull);
      expect(fetch.calls, 1);
    });

    test('alerts and completes when condition matches after change', () async {
      final fetch = StubFetchApi([
        'Sold out — check back later',
        'Tickets are on sale now! Buy here.',
      ]);
      final ollama = FakeOllama(
        onChat: (messages, tools, model, format) async {
          expect(model, 'small-model');
          return OllamaChatMessage(
            role: 'assistant',
            content: '{"triggered":true,"evidence":"Tickets are on sale now!"}',
          );
        },
      );
      final services = testServices(
        tools: [],
        fetchApi: fetch,
        ollama: ollama,
      );
      final task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.watch,
        payload: WatchSpec(
          url: 'https://example.com/tickets',
          condition: 'tickets are on sale',
          intervalMinutes: 15,
          untilTriggered: true,
        ).encode(),
        timezone: 'UTC',
        recurrence: '*/15 * * * *',
        stateJson: WatchState().encode(),
      );

      final first = await Watcher(services).run(task);
      expect(first.alert, isNull);
      services.tasks.updateAfterRun(
        id: task.id,
        ranAt: DateTime.utc(2026, 7, 30, 10),
        nextRunAt: DateTime.utc(2026, 7, 30, 10, 15),
        stateJson: first.state.encode(),
      );

      final second = await Watcher(services).run(services.tasks.byId(task.id)!);
      expect(second.alert, contains('Watcher triggered'));
      expect(second.alert, contains('Tickets are on sale'));
      expect(second.done, isTrue);
      expect(ollama.chatCalls, 1);
    });

    test('warns owner after three consecutive fetch failures', () async {
      final fetch = StubFetchApi([
        Exception('down'),
        Exception('down'),
        Exception('down'),
      ]);
      final services = testServices(tools: [], fetchApi: fetch);
      var task = services.tasks.create(
        createdBy: ownerId,
        channelId: '42',
        kind: TaskKind.watch,
        payload: WatchSpec(
          url: 'https://example.com/x',
          condition: 'ready',
          intervalMinutes: 15,
          untilTriggered: true,
        ).encode(),
        timezone: 'UTC',
        recurrence: '*/15 * * * *',
        stateJson: WatchState().encode(),
      );

      WatchRunResult? last;
      for (var i = 0; i < 3; i++) {
        last = await Watcher(services).run(task);
        services.tasks.updateAfterRun(
          id: task.id,
          ranAt: DateTime.utc(2026, 7, 30, 10, i),
          nextRunAt: DateTime.utc(2026, 7, 30, 10, i + 15),
          stateJson: last.state.encode(),
        );
        task = services.tasks.byId(task.id)!;
      }
      expect(last!.ownerWarning, contains('failed 3 times'));
      expect(last.state.consecutiveFailures, 3);
    });
  });

  group('watch_url tool', () {
    test('enforces 3-watcher cap for non-owners', () async {
      final services = testServices(tools: [WatchUrlTool()]);
      final tool = WatchUrlTool();
      final ctx = contextFor(services, owner: false);

      Future<void> createOne(int i) async {
        final result = await tool.execute(ctx, {
          'url': 'https://example.com/p$i',
          'condition': 'change $i',
          'interval': '15m',
        });
        expect(result.isError, isFalse, reason: '${result.json}');
      }

      await createOne(1);
      await createOne(2);
      await createOne(3);
      final blocked = await tool.execute(ctx, {
        'url': 'https://example.com/p4',
        'condition': 'change 4',
        'interval': '15m',
      });
      expect(blocked.isError, isTrue);
      expect(blocked.json['error'], contains('Watcher cap'));
    });

    test('owner is uncapped and rejects private URLs', () async {
      final services = testServices(tools: [WatchUrlTool()]);
      final tool = WatchUrlTool();
      final ctx = contextFor(services, owner: true);

      for (var i = 0; i < 4; i++) {
        final result = await tool.execute(ctx, {
          'url': 'https://example.com/o$i',
          'condition': 'x',
          'interval': '30m',
        });
        expect(result.isError, isFalse, reason: '${result.json}');
      }

      final private = await tool.execute(ctx, {
        'url': 'http://127.0.0.1/secret',
        'condition': 'x',
        'interval': '15m',
      });
      expect(private.isError, isTrue);
      expect(private.json['error'], contains('blocked'));
    });
  });

  group('http_request tool', () {
    test('GET needs no preview; POST previews exact request', () async {
      final tool = HttpRequestTool();
      final services = testServices(tools: [tool]);
      final ctx = contextFor(services, owner: true);

      expect(
        await tool.previewChange(ctx, {
          'method': 'GET',
          'url': 'https://example.com/api',
        }),
        isNull,
      );

      final preview = await tool.previewChange(ctx, {
        'method': 'POST',
        'url': 'https://example.com/api',
        'headers': {'Content-Type': 'application/json'},
        'body': '{"a":1}',
      });
      expect(preview, contains('HTTP POST https://example.com/api'));
      expect(preview, contains('Content-Type: application/json'));
      expect(preview, contains('{"a":1}'));
    });

    test('execute blocks private targets before connect', () async {
      final tool = HttpRequestTool();
      final services = testServices(tools: [tool]);
      final ctx = contextFor(services, owner: true);
      final result = await tool.execute(ctx, {
        'method': 'GET',
        'url': 'http://192.168.0.5/x',
      });
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('blocked'));
    });
  });
}
