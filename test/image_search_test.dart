import 'package:egon_bot/src/tools/builtin/image_search_tool.dart';
import 'package:egon_bot/src/web/image_search_api.dart';
import 'package:test/test.dart';

import 'helpers.dart';

void main() {
  group('ImageSearchApi.extractVqd', () {
    test('reads quoted vqd from SERP bootstrap', () {
      const html =
          'var locale="en_US",vqd="4-263370365609857148037566711059260580325",'
          'safe_ddg=0;';
      expect(
        ImageSearchApi.extractVqd(html),
        '4-263370365609857148037566711059260580325',
      );
    });

    test('returns null when missing', () {
      expect(ImageSearchApi.extractVqd('<html></html>'), isNull);
    });
  });

  group('ImageSearchApi.parseResults', () {
    test('maps image hits and caps limit', () {
      const body = '''
{
  "results": [
    {
      "title": "Orange cat",
      "image": "https://cdn.example.com/full.jpg",
      "thumbnail": "https://t.example.com/thumb.jpg",
      "url": "https://example.com/post",
      "width": 800,
      "height": 600
    },
    {
      "title": "Another",
      "image": "https://cdn.example.com/2.jpg",
      "thumbnail": "https://t.example.com/2.jpg",
      "url": "https://example.com/2"
    },
    {
      "title": "Third",
      "image": "https://cdn.example.com/3.jpg",
      "thumbnail": "https://t.example.com/3.jpg",
      "url": "https://example.com/3"
    }
  ]
}
''';
      final results = ImageSearchApi.parseResults(body, limit: 2);
      expect(results, hasLength(2));
      expect(results[0].title, 'Orange cat');
      expect(results[0].imageUrl, 'https://cdn.example.com/full.jpg');
      expect(results[0].thumbnailUrl, 'https://t.example.com/thumb.jpg');
      expect(results[0].sourcePage, 'https://example.com/post');
      expect(results[0].width, 800);
      expect(results[0].height, 600);
      expect(results[1].imageUrl, 'https://cdn.example.com/2.jpg');
    });

    test('skips non-http urls and duplicates', () {
      const body = '''
{
  "results": [
    {"title": "a", "image": "data:image/png;base64,aaa", "url": "https://x"},
    {"title": "b", "image": "https://cdn.example.com/x.jpg", "url": "https://x"},
    {"title": "c", "image": "https://cdn.example.com/x.jpg", "url": "https://y"},
    {"title": "d", "image": "ftp://cdn.example.com/x.jpg", "url": "https://z"}
  ]
}
''';
      final results = ImageSearchApi.parseResults(body, limit: 5);
      expect(results, hasLength(1));
      expect(results.single.imageUrl, 'https://cdn.example.com/x.jpg');
    });

    test('returns empty on invalid JSON', () {
      expect(ImageSearchApi.parseResults('not-json', limit: 5), isEmpty);
      expect(ImageSearchApi.parseResults('[]', limit: 5), isEmpty);
    });
  });

  group('image_search tool', () {
    test('rejects empty query', () async {
      final services = testServices(tools: [ImageSearchTool()]);
      final result = await ImageSearchTool().execute(
        contextFor(services, owner: true),
        {},
      );
      expect(result.isError, isTrue);
      expect(result.json['error'], contains('non-empty'));
    });

    test('returns mapped results from ImageSearchApi', () async {
      final services = testServices(
        tools: [ImageSearchTool()],
        imageSearchApi: _StubImageSearchApi([
          ImageSearchResult(
            title: 'A very long title ' * 20,
            imageUrl: 'https://cdn.example.com/a.jpg',
            thumbnailUrl: 'https://t.example.com/a.jpg',
            sourcePage: 'https://example.com/a',
            width: 100,
            height: 50,
          ),
        ]),
      );
      final result = await ImageSearchTool().execute(
        contextFor(services, owner: true),
        {'query': 'orange cat'},
      );
      expect(result.isError, isFalse);
      expect(result.json['query'], 'orange cat');
      final results = result.json['results'] as List<Object?>;
      expect(results, hasLength(1));
      final first = results.single as Map<String, Object?>;
      expect(first['image_url'], 'https://cdn.example.com/a.jpg');
      expect(first['thumbnail_url'], 'https://t.example.com/a.jpg');
      expect(first['source_page'], 'https://example.com/a');
      expect(first['width'], 100);
      expect(first['height'], 50);
      expect((first['title'] as String).length, lessThanOrEqualTo(160));
    });

    test('notes empty results', () async {
      final services = testServices(
        tools: [ImageSearchTool()],
        imageSearchApi: _StubImageSearchApi(const []),
      );
      final result = await ImageSearchTool().execute(
        contextFor(services, owner: true),
        {'query': 'xyzzy-no-hit'},
      );
      expect(result.isError, isFalse);
      expect(result.json['results'], isEmpty);
      expect(result.json['note'], contains('No images'));
      expect(result.json['safe_search'], isTrue);
    });

    test('passes safe_search=false through to the API', () async {
      final stub = _StubImageSearchApi(const []);
      final services = testServices(
        tools: [ImageSearchTool()],
        imageSearchApi: stub,
      );
      final result = await ImageSearchTool().execute(
        contextFor(services, owner: true),
        {'query': 'nsfw art', 'safe_search': false},
      );
      expect(result.isError, isFalse);
      expect(stub.lastSafeSearch, isFalse);
      expect(result.json['safe_search'], isFalse);
    });
  });
}

class _StubImageSearchApi extends ImageSearchApi {
  _StubImageSearchApi(this.results);

  final List<ImageSearchResult> results;
  bool? lastSafeSearch;

  @override
  Future<List<ImageSearchResult>> search(
    String query, {
    int limit = 5,
    bool safeSearch = true,
  }) async {
    lastSafeSearch = safeSearch;
    return results.take(limit).toList();
  }
}
