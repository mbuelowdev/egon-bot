import '../tool.dart';

class FetchUrlTool extends Tool {
  @override
  String get name => 'fetch_url';

  @override
  String get description =>
      'Loads a public http(s) page as plain text plus discovered image URLs. '
      'Use when the user gives a concrete URL, or to read a web_search result. '
      'Returns {url, title, text, content_type, truncated, images[]} where '
      'images entries are {url, alt, kind} (kind=og|twitter|link|img). Prefer '
      'og images, then download_and_send that URL to post a picture. Not for '
      'binary files or direct image URLs — use download_and_send.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'url': {'type': 'string', 'description': 'Complete http(s) URL.'},
        },
        'required': ['url'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final url = (args['url'] as String?)?.trim() ?? '';
    if (url.isEmpty) {
      return ToolResult.error('fetch_url needs a non-empty http(s) URL.');
    }
    try {
      final page = await context.services.fetchApi.fetch(url);
      return ToolResult.ok(page.toJson());
    } catch (error) {
      return ToolResult.error('Could not load the page: $error');
    }
  }
}
