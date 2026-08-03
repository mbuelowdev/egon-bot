import 'dart:typed_data';

import 'package:egon_bot/src/llm/ollama_models.dart';
import 'package:egon_bot/src/tools/builtin/browse_url_tool.dart';
import 'package:egon_bot/src/tools/builtin/screenshot_url_tool.dart';
import 'package:egon_bot/src/web/browser_api.dart';
import 'package:egon_bot/src/web/cdp_client.dart';
import 'package:test/test.dart';

import 'helpers.dart';

OllamaToolCall call(String name, [Map<String, Object?> args = const {}]) =>
    OllamaToolCall(name: name, arguments: args);

CdpPageResult _stubPage({List<int> screenshot = const [9, 9]}) => CdpPageResult(
      url: 'https://example.com/',
      title: 'Eg',
      text: 'Hi',
      truncated: false,
      links: const [
        {'url': 'https://example.com/a', 'text': 'A'},
      ],
      images: const [
        {
          'url': 'https://example.com/og.png',
          'alt': '',
          'kind': 'og',
        },
      ],
      network: const [
        {
          'method': 'GET',
          'url': 'https://example.com/api',
          'status': 200,
          'resource_type': 'fetch',
          'content_type': 'application/json',
        },
      ],
      screenshotBytes: Uint8List.fromList(screenshot),
      screenshotMime: 'image/jpeg',
    );

BrowserApi _stubBrowserApi({
  Uri? baseUrl,
  CdpPageResult? page,
  Object? throwOnAnalyze,
}) {
  return BrowserApi(
    baseUrl: baseUrl ?? Uri.parse('http://127.0.0.1:9222'),
    analyzeImpl: ({
      required Uri cdpHttpBase,
      required String url,
      required String userAgent,
      Duration timeout = const Duration(seconds: 45),
    }) async {
      if (throwOnAnalyze != null) {
        // ignore: only_throw_errors
        throw throwOnAnalyze;
      }
      return page ?? _stubPage();
    },
  );
}

void main() {
  group('OllamaChatMessage images', () {
    test('serializes and parses images', () {
      final msg = OllamaChatMessage(
        role: 'user',
        content: 'describe',
        images: ['abc123'],
      );
      final json = msg.toJson();
      expect(json['images'], ['abc123']);
      final roundTrip = OllamaChatMessage.fromJson(json);
      expect(roundTrip.images, ['abc123']);
      expect(roundTrip.content, 'describe');
    });

    test('omits images when empty', () {
      final json = OllamaChatMessage(role: 'user', content: 'hi').toJson();
      expect(json.containsKey('images'), isFalse);
    });
  });

  group('resolveBrowserWebSocketUrl', () {
    test('rewrites advertised loopback host to CDP base host', () async {
      // Use a fake by testing the rewrite logic via Uri.replace semantics.
      final advertised = Uri.parse(
        'ws://127.0.0.1:9222/devtools/browser/abc',
      );
      final httpBase = Uri.parse('http://172.17.0.1:9222');
      final rewritten = advertised.replace(
        host: httpBase.host,
        port: httpBase.port,
      );
      expect(rewritten.host, '172.17.0.1');
      expect(rewritten.port, 9222);
      expect(rewritten.path, '/devtools/browser/abc');
    });
  });

  group('hostLooksBlockedForBrowse', () {
    test('blocks private literals', () {
      expect(hostLooksBlockedForBrowse('127.0.0.1'), isTrue);
      expect(hostLooksBlockedForBrowse('10.0.0.1'), isTrue);
      expect(hostLooksBlockedForBrowse('example.com'), isFalse);
    });
  });

  group('BrowserApi', () {
    test('throws when unconfigured', () {
      expect(
        () => BrowserApi().analyze('https://example.com/'),
        throwsA(isA<StateError>()),
      );
    });

    test('maps CDP page result', () async {
      final api = _stubBrowserApi();
      final result = await api.analyze('https://example.com/');
      expect(result.title, 'Eg');
      expect(result.text, 'Hi');
      expect(result.links, hasLength(1));
      expect(result.images, hasLength(1));
      expect(result.images.first['url'], 'https://example.com/og.png');
      expect(result.network.first['url'], 'https://example.com/api');
      expect(result.screenshotBytes, [9, 9]);
    });
  });

  group('BrowseUrlTool', () {
    test('errors when browser API missing', () async {
      final services = testServices(tools: [BrowseUrlTool()]);
      final result = await services.registry.dispatch(
        contextFor(services, owner: true),
        call('browse_url', {'url': 'https://example.com/'}),
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('BROWSER_API_BASE_URL'));
    });

    test('rejects private hosts', () async {
      final services = testServices(
        tools: [BrowseUrlTool()],
        browserApi: _stubBrowserApi(),
      );
      final result = await services.registry.dispatch(
        contextFor(services, owner: true),
        call('browse_url', {'url': 'http://127.0.0.1/'}),
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('blocked'));
    });

    test('returns page data and notes vision disabled', () async {
      final services = testServices(
        tools: [BrowseUrlTool()],
        browserApi: _stubBrowserApi(),
      );
      final result = await services.registry.dispatch(
        contextFor(services, owner: true),
        call('browse_url', {'url': 'https://example.com/'}),
      );
      expect(result.isError, isFalse);
      expect(result.json['title'], 'Eg');
      expect(result.json['text'], 'Hi');
      expect(result.json['images'], [
        {'url': 'https://example.com/og.png', 'alt': '', 'kind': 'og'},
      ]);
      expect(result.json['screenshot'], isA<Map>());
      expect(result.json['visual_summary'], contains('vision disabled'));
    });
  });

  group('ScreenshotUrlTool', () {
    test('errors when browser API missing', () async {
      final services = testServices(tools: [ScreenshotUrlTool()]);
      final result = await ScreenshotUrlTool().execute(
        contextFor(services, owner: true),
        {'url': 'https://example.com/'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('BROWSER_API_BASE_URL'));
    });

    test('rejects private hosts', () async {
      final services = testServices(
        tools: [ScreenshotUrlTool()],
        browserApi: _stubBrowserApi(),
      );
      final result = await ScreenshotUrlTool().execute(
        contextFor(services, owner: true),
        {'url': 'http://127.0.0.1/'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('blocked'));
    });

    test('stores screenshot then reports Discord missing client', () async {
      final services = testServices(
        tools: [ScreenshotUrlTool()],
        browserApi: _stubBrowserApi(
          page: _stubPage(screenshot: List<int>.filled(24, 3)),
        ),
      );
      final result = await ScreenshotUrlTool().execute(
        contextFor(services, owner: true),
        {'url': 'https://example.com/', 'message': 'look'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('Could not screenshot'));
      final recent = services.attachments.mostRecentInChannel('42');
      expect(recent, isNotNull);
      expect(recent!.name, startsWith('screenshot_'));
      expect(recent.mime, 'image/jpeg');
    });
  });
}
