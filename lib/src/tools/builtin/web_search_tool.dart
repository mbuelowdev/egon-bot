import '../tool.dart';

/// Cap each snippet so a verbose page can't blow the prompt budget.
const _maxSnippetChars = 280;
const _maxResults = 5;

class WebSearchTool extends Tool {
  @override
  String get name => 'web_search';

  @override
  String get description =>
      'Searches the public web for current facts when you do not already have '
      'a URL. Use for news, prices, dates, sports, weather, releases — not '
      'when the user pasted a concrete page/image URL (use fetch_url / '
      'download_and_send). Returns {title, snippet, url}; read a result with '
      'fetch_url. Takes a short query — never a URL.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'query': {
            'type': 'string',
            'description':
                'Short, precise search query in the user\'s language.',
          },
        },
        'required': ['query'],
      };

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final query = (args['query'] as String?)?.trim() ?? '';
    if (query.isEmpty) {
      return ToolResult.error(
        'web_search needs a non-empty "query". URLs belong to fetch_url.',
      );
    }
    final results = await context.services.searchApi.search(
      query,
      limit: _maxResults,
    );
    if (results.isEmpty) {
      return ToolResult.ok({
        'query': query,
        'results': <Object?>[],
        'note': 'No results. Say so naturally in the chat language.',
      });
    }
    return ToolResult.ok({
      'query': query,
      'results': [
        for (final r in results)
          {
            'title': r.title,
            'snippet': _truncate(r.snippet, _maxSnippetChars),
            'url': r.url,
          },
      ],
    });
  }

  String _truncate(String input, int maxChars) {
    if (input.length <= maxChars) return input;
    return '${input.substring(0, maxChars - 1)}…';
  }
}
