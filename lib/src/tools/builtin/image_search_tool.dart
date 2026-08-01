import '../tool.dart';

const _maxTitleChars = 160;
const _maxResults = 5;

class ImageSearchTool extends Tool {
  @override
  String get name => 'image_search';

  @override
  String get description =>
      'Searches the public web for images (DuckDuckGo Images). Use when the '
      'user wants a picture/photo/meme of something and has no URL yet. '
      'Returns up to 5 {title, image_url, thumbnail_url, source_page, width, '
      'height}. Post one with download_and_send(image_url) — prefer image_url '
      'over thumbnail_url. SafeSearch is on by default; set safe_search=false '
      'only when the user explicitly asks for unsafe/NSFW/unfiltered images. '
      'Not for text facts (web_search), concrete page URLs (fetch_url), or '
      'direct image URLs (download_and_send). Never invent image URLs.';

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'query': {
            'type': 'string',
            'description':
                'Short image search query in the user\'s language '
                '(what the picture should show).',
          },
          'safe_search': {
            'type': 'boolean',
            'description':
                'Default true. Set false only if the user explicitly asks '
                'for unsafe, NSFW, uncensored, or unfiltered images.',
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
        'image_search needs a non-empty "query". Direct image URLs belong to '
        'download_and_send.',
      );
    }
    final safeSearch = args['safe_search'] as bool? ?? true;
    final results = await context.services.imageSearchApi.search(
      query,
      limit: _maxResults,
      safeSearch: safeSearch,
    );
    if (results.isEmpty) {
      return ToolResult.ok({
        'query': query,
        'safe_search': safeSearch,
        'results': <Object?>[],
        'note': 'No images found. Say so naturally in the chat language.',
      });
    }
    return ToolResult.ok({
      'query': query,
      'safe_search': safeSearch,
      'results': [
        for (final r in results)
          {
            'title': _truncate(r.title, _maxTitleChars),
            'image_url': r.imageUrl,
            'thumbnail_url': r.thumbnailUrl,
            'source_page': r.sourcePage,
            if (r.width != null) 'width': r.width,
            if (r.height != null) 'height': r.height,
          },
      ],
    });
  }

  String _truncate(String input, int maxChars) {
    if (input.length <= maxChars) return input;
    return '${input.substring(0, maxChars - 1)}…';
  }
}
