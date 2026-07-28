import '../tool.dart';

class FetchUrlTool extends Tool {
  @override
  String get name => 'fetch_url';

  @override
  String get description =>
      'Loads a public web page as plain text. Use after web_search to read a '
      'result fully, or when a concrete http(s) URL is available. Returns '
      '{url, title, text, content_type, truncated}; long pages are cut off. '
      'Only http/https, no binary files.';

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
