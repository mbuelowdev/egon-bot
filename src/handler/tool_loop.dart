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
      'Sucht im öffentlichen Web nach aktuellen Fakten. Nur nutzen, wenn die '
      'Frage Infos braucht, die du nicht sicher aus Allgemeinwissen beantworten '
      'kannst (Nachrichten, Daten, Preise, Sport, Wetter, Termine, Spielzeiten '
      'usw.). Nicht für Meinungen oder Witze. Liefert {title, snippet, url} '
      'pro Treffer; mit fetch_url eine URL vollständig lesen. '
      'Antwort an den Nutzer immer in dessen Sprache formulieren.',
  parameters: {
    'type': 'object',
    'properties': {
      'query': {
        'type': 'string',
        'description':
            'Suchbegriff in der Sprache des Nutzers, kurz und präzise.',
      },
    },
    'required': ['query'],
  },
);

/// Tool schema sent to Ollama declaring the `fetch_url` capability.
const OllamaTool fetchUrlTool = OllamaTool(
  name: 'fetch_url',
  description:
      'Lädt eine öffentliche Webseite als Klartext. Nach web_search nutzen, '
      'um ein Suchergebnis voll zu lesen, oder wenn eine konkrete http(s)-URL '
      'vorliegt. Rückgabe: {url, title, text, content_type, truncated}; lange '
      'Seiten werden gekürzt. Nur http/https; keine Binärdateien. '
      'Antwort an den Nutzer immer in dessen Sprache formulieren.',
  parameters: {
    'type': 'object',
    'properties': {
      'url': {
        'type': 'string',
        'description': 'Vollständige http(s)-URL.',
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
        'Tool-Limit für diese Runde erreicht. Antworte jetzt in deinem '
        'normalen Stil nur mit dem, was du schon weißt — gleiche Sprache wie '
        'der Chat, kein Englisch und keine Meta-Kommentare.',
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
              'web_search braucht ein nicht leeres „query“. URLs gehören zu '
              'fetch_url, nicht hierher.',
        };
      }
      try {
        final results = await searchApi.search(query, limit: _maxResults);
        if (results.isEmpty) {
          return {
            'query': query,
            'results': <Object?>[],
            'hinweis':
                'Keine Online-Treffer. Sag das locker in der Sprache des '
                'Chats — ohne englische Kurzkommentare oder Meta-Sätze.',
          };
        }
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
        return {
          'error':
              'Suche ist fehlgeschlagen. Kurz in Chat-Sprache erklären, ohne '
              'englische Floskeln.',
        };
      }
    case 'fetch_url':
      final url = (call.arguments['url'] as String?)?.trim() ?? '';
      if (url.isEmpty) {
        return {
          'error':
              'fetch_url braucht eine nicht leere http(s)-URL.',
        };
      }
      try {
        final page = await fetchApi.fetch(url);
        return page.toJson();
      } catch (error) {
        stderr.writeln('fetch_url dispatch failed for $url: $error');
        return {
          'error':
              'Seite konnte nicht geladen werden. Kurz in Chat-Sprache sagen, '
              'ohne englische Floskeln.',
        };
      }
    default:
      return {'error': 'Unbekanntes Tool: ${call.name}'};
  }
}

String _truncate(String input, int maxChars) {
  if (input.length <= maxChars) return input;
  return '${input.substring(0, maxChars - 1)}…';
}
