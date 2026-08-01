import 'dart:typed_data';

import 'package:egon_bot/src/tools/builtin/download_and_send_tool.dart';
import 'package:egon_bot/src/web/fetch_api.dart';
import 'package:html/parser.dart' as html_parser;
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('extractPageImages', () {
    test('prefers og:image over img and resolves relative URLs', () {
      final html = '''
<html><head>
  <meta property="og:image" content="/cdn/hero.jpg">
  <meta name="twitter:image" content="https://cdn.example.com/tw.png">
  <link rel="image_src" href="https://cdn.example.com/link.png">
</head><body>
  <img src="pics/a.png" alt="A">
  <img srcset="small.jpg 320w, large.jpg 1280w" alt="B">
</body></html>
''';
      final doc = html_parser.parse(html);
      final images = extractPageImages(
        doc,
        Uri.parse('https://example.com/post/1'),
      );

      expect(images.map((i) => i.kind).toList(), [
        'og',
        'twitter',
        'link',
        'img',
        'img',
      ]);
      expect(images[0].url, 'https://example.com/cdn/hero.jpg');
      expect(images[1].url, 'https://cdn.example.com/tw.png');
      expect(images[2].url, 'https://cdn.example.com/link.png');
      expect(images[3].url, 'https://example.com/post/pics/a.png');
      expect(images[3].alt, 'A');
      expect(images[4].url, 'https://example.com/post/large.jpg');
      expect(images[4].alt, 'B');
    });

    test('skips data URIs and deduplicates', () {
      final html = '''
<html><body>
  <img src="data:image/png;base64,aaa">
  <img src="https://cdn.example.com/x.png">
  <meta property="og:image" content="https://cdn.example.com/x.png">
</body></html>
''';
      final doc = html_parser.parse(html);
      final images = extractPageImages(
        doc,
        Uri.parse('https://example.com/'),
      );
      // og is collected first, then img is skipped as duplicate.
      expect(images, hasLength(1));
      expect(images.single.kind, 'og');
      expect(images.single.url, 'https://cdn.example.com/x.png');
    });

    test('respects maxImages', () {
      final imgs = List.generate(
        20,
        (i) => '<img src="https://cdn.example.com/$i.png">',
      ).join();
      final doc = html_parser.parse('<html><body>$imgs</body></html>');
      final images = extractPageImages(
        doc,
        Uri.parse('https://example.com/'),
        maxImages: 3,
      );
      expect(images, hasLength(3));
    });
  });

  group('download_and_send tool', () {
    test('rejects empty url', () async {
      final services = testServices(tools: [DownloadAndSendTool()]);
      final result = await DownloadAndSendTool().execute(
        contextFor(services, owner: true),
        {},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('non-empty'));
    });

    test('surfaces download failures', () async {
      final services = testServices(
        tools: [DownloadAndSendTool()],
        fetchApi: _FailingDownloadApi(),
      );
      final result = await DownloadAndSendTool().execute(
        contextFor(services, owner: true),
        {'url': 'https://cdn.example.com/photo.jpg'},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('Could not download'));
    });

    test('stores file then reports Discord missing client', () async {
      final services = testServices(
        tools: [DownloadAndSendTool()],
        fetchApi: _StubDownloadApi(),
      );
      final result = await DownloadAndSendTool().execute(
        contextFor(services, owner: true),
        {
          'url': 'https://cdn.example.com/photo.jpg',
          'message': 'here',
        },
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('could not post'));
      final recent = services.attachments.mostRecentInChannel('42');
      expect(recent, isNotNull);
      expect(recent!.name, 'photo.jpg');
      expect(recent.mime, 'image/jpeg');
    });
  });
}

class _FailingDownloadApi extends FetchApi {
  @override
  Future<DownloadedFile> download(String url, {int? maxBytes}) async {
    throw Exception('network down');
  }
}

class _StubDownloadApi extends FetchApi {
  @override
  Future<DownloadedFile> download(String url, {int? maxBytes}) async {
    return DownloadedFile(
      url: url,
      name: 'photo.jpg',
      mime: 'image/jpeg',
      bytes: Uint8List.fromList(List<int>.filled(32, 7)),
    );
  }
}
