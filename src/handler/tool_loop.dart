import 'dart:convert';
import 'dart:io';

import '../api/external_api.dart';
import '../api/fetch_api.dart';
import '../api/ollama_models.dart';
import '../api/search_api.dart';

/// Tool schema sent to Ollama declaring the `web_search` capability.
const OllamaTool webSearchTool = OllamaTool(
  name: 'web_search',
  description:
      'Search the public web for up-to-date facts. Use only when the question '
      'requires information you cannot answer from general knowledge '
      '(current events, recent prices, dates, sports scores, weather, '
      'recent releases, etc.). Do not use for opinions or jokes. Returns a '
      'list of {title, snippet, url}; pass any of those URLs to fetch_url to '
      'read the full page.',
  parameters: {
    'type': 'object',
    'properties': {
      'query': {
        'type': 'string',
        'description': "Search query in the user's language. Keep it concise.",
      },
    },
    'required': ['query'],
  },
);

/// Tool schema sent to Ollama declaring the `fetch_url` capability.
const OllamaTool fetchUrlTool = OllamaTool(
  name: 'fetch_url',
  description:
      'Fetch the contents of a public web page as plain text. Use after '
      'web_search to read a result in full, or whenever you have a concrete '
      'http(s) URL whose contents you need. Returns {url, title, text, '
      'content_type, truncated}; long pages are cut off. Only http and https '
      'URLs are supported; binary content is rejected.',
  parameters: {
    'type': 'object',
    'properties': {
      'url': {
        'type': 'string',
        'description': 'Absolute http(s) URL to fetch.',
      },
    },
    'required': ['url'],
  },
);

/// Cap each search result snippet so a verbose page can't blow the prompt budget.
const _maxSnippetChars = 280;

/// Cap on the number of results fed back to the model per web_search call.
const _maxResults = 5;

/// Runs a bounded model <-> tool conversation until the model returns a final
/// reply with no further tool calls, or until [maxRounds] tool-permitted
/// rounds have been exhausted, in which case one final tools-disabled round
/// is forced so the user always gets an answer.
///
/// [maxRounds] defaults high enough to allow several search + fetch cycles
/// per turn; it exists purely as a runaway-loop safety net.
Future<String> runToolLoop({
  required ExternalApi externalApi,
  required SearchApi searchApi,
  required FetchApi fetchApi,
  required List<OllamaChatMessage> initialMessages,
  int maxRounds = 20,
}) async {
  final messages = List<OllamaChatMessage>.of(initialMessages);

  for (var round = 0; round < maxRounds; round++) {
    final assistant = await externalApi.chatCompletion(
      messages: messages,
      tools: const [webSearchTool, fetchUrlTool],
    );

    if (assistant.toolCalls.isEmpty) {
      return assistant.content.trim();
    }

    messages.add(assistant);

    for (final call in assistant.toolCalls) {
      stdout.writeln(
        'Tool call round ${round + 1}: ${call.name}(${jsonEncode(call.arguments)})',
      );
      final result = await _dispatch(
        call,
        searchApi: searchApi,
        fetchApi: fetchApi,
      );
      messages.add(OllamaChatMessage(
        role: 'tool',
        content: jsonEncode(result),
        toolCallId: call.id,
        name: call.name,
      ));
    }
  }

  // Tool budget exhausted: force a final, tools-disabled answer so the user
  // never sees an unfinished tool dance.
  messages.add(OllamaChatMessage(
    role: 'system',
    content:
        'You have used your tool budget for this turn. Reply now in your '
        'normal voice using only the facts you have already gathered.',
  ));
  final finalAssistant = await externalApi.chatCompletion(
    messages: messages,
    tools: const [],
  );
  return finalAssistant.content.trim();
}

Future<Map<String, Object?>> _dispatch(
  OllamaToolCall call, {
  required SearchApi searchApi,
  required FetchApi fetchApi,
}) async {
  switch (call.name) {
    case 'web_search':
      final query = (call.arguments['query'] as String?)?.trim() ?? '';
      if (query.isEmpty) {
        return {
          'error':
              'web_search requires a non-empty "query" argument. It does not '
                  'accept a "url" parameter — use fetch_url for that.',
        };
      }
      try {
        final results = await searchApi.search(query, limit: _maxResults);
        return {
          'query': query,
          'results': results
              .map((r) => {
                    'title': r.title,
                    'snippet': _truncate(r.snippet, _maxSnippetChars),
                    'url': r.url,
                  })
              .toList(),
        };
      } catch (error) {
        stderr.writeln('web_search dispatch failed: $error');
        return {'error': 'web_search failed'};
      }
    case 'fetch_url':
      final url = (call.arguments['url'] as String?)?.trim() ?? '';
      if (url.isEmpty) {
        return {
          'error':
              'fetch_url requires a non-empty "url" argument (absolute http or https).',
        };
      }
      try {
        final page = await fetchApi.fetch(url);
        return page.toJson();
      } catch (error) {
        stderr.writeln('fetch_url dispatch failed for $url: $error');
        return {'error': 'fetch_url failed: $error'};
      }
    default:
      return {'error': 'unknown tool: ${call.name}'};
  }
}

String _truncate(String input, int maxChars) {
  if (input.length <= maxChars) return input;
  return '${input.substring(0, maxChars - 1)}…';
}
