import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

/// Single search result returned by [SearchApi.search].
class SearchResult {
  SearchResult({
    required this.title,
    required this.snippet,
    required this.url,
  });

  final String title;
  final String snippet;
  final String url;

  Map<String, Object?> toJson() => {
        'title': title,
        'snippet': snippet,
        'url': url,
      };
}

/// Keyless web search backed by DuckDuckGo's `lite` HTML endpoint.
///
/// The lite endpoint emits a deterministic table-based layout that has been
/// stable for years, which makes it the most reliable scraping target among
/// the no-registration options. On any failure (timeout, non-2xx, parsing
/// problem) [search] returns an empty list so the caller can continue without
/// crashing the chat loop.
class SearchApi {
  SearchApi({HttpClient? httpClient, Duration? timeout})
      : _httpClient = httpClient ?? HttpClient(),
        _timeout = timeout ?? const Duration(seconds: 6);

  static final Uri _endpoint = Uri.parse('https://lite.duckduckgo.com/lite/');

  /// A realistic desktop user-agent. DDG lite serves the simple layout to
  /// most browsers; an obviously-empty UA tends to draw bot challenges.
  static const String _userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  final HttpClient _httpClient;
  final Duration _timeout;

  Future<List<SearchResult>> search(String query, {int limit = 5}) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      return const [];
    }

    try {
      final body = await _fetchHtml(trimmed);
      return _parseResults(body, limit: limit);
    } catch (error, stackTrace) {
      stderr.writeln('Web search for "$trimmed" failed: $error');
      stderr.writeln(stackTrace);
    }

    // One quick retry to dodge transient flakes (Cloudflare warmup, brief 5xx).
    try {
      await Future<void>.delayed(const Duration(milliseconds: 350));
      final body = await _fetchHtml(trimmed);
      return _parseResults(body, limit: limit);
    } catch (error) {
      stderr.writeln('Web search retry for "$trimmed" failed: $error');
      return const [];
    }
  }

  Future<String> _fetchHtml(String query) async {
    final uri = _endpoint.replace(queryParameters: {'q': query});
    final request = await _httpClient.getUrl(uri).timeout(_timeout);
    request.headers
      ..set(HttpHeaders.userAgentHeader, _userAgent)
      ..set(HttpHeaders.acceptHeader, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
      ..set(HttpHeaders.acceptLanguageHeader, 'de-DE,de;q=0.9,en;q=0.8');
    final response = await request.close().timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'DDG lite returned ${response.statusCode} for $uri',
      );
    }
    return utf8.decodeStream(response).timeout(_timeout);
  }

  List<SearchResult> _parseResults(String html, {required int limit}) {
    final document = html_parser.parse(html);

    // Preferred path: the lite layout marks result titles with `a.result-link`.
    var anchors = document.querySelectorAll('a.result-link');

    // Defensive fallback: if class names ever drift, fall back to any anchor
    // whose href is a DDG redirect (`/l/?uddg=...`).
    if (anchors.isEmpty) {
      anchors = document.querySelectorAll('a').where((a) => _looksLikeResultLink(a.attributes['href'])).toList();
    }

    final results = <SearchResult>[];
    final seenUrls = <String>{};
    for (final anchor in anchors) {
      if (results.length >= limit) break;
      final title = _normalizeWhitespace(anchor.text);
      final url = _resolveDdgRedirect(anchor.attributes['href']);
      if (title.isEmpty || url == null) continue;
      if (!seenUrls.add(url)) continue;
      final snippet = _findFollowingSnippet(anchor) ?? '';
      results.add(SearchResult(title: title, snippet: snippet, url: url));
    }
    return results;
  }

  bool _looksLikeResultLink(String? href) {
    if (href == null || href.isEmpty) return false;
    return href.contains('/l/?uddg=') || href.contains('uddg=');
  }

  String? _resolveDdgRedirect(String? href) {
    if (href == null || href.isEmpty) return null;
    Uri? parsed;
    try {
      parsed = Uri.parse(href.startsWith('//') ? 'https:$href' : href);
    } catch (_) {
      return null;
    }
    final uddg = parsed.queryParameters['uddg'];
    if (uddg != null && uddg.isNotEmpty) {
      // DDG double-encodes the target; one decodeComponent is enough because
      // queryParameters has already done the first decode.
      return uddg;
    }
    if (parsed.scheme == 'http' || parsed.scheme == 'https') {
      return parsed.toString();
    }
    return null;
  }

  /// Walks forward from the row containing [anchor] looking for the matching
  /// `td.result-snippet` cell. DDG lite emits a (title-row, snippet-row,
  /// url-row) triplet per result.
  String? _findFollowingSnippet(dom.Element anchor) {
    dom.Element? row = anchor;
    while (row != null && row.localName != 'tr') {
      row = row.parent;
    }
    if (row == null) return null;
    var sibling = row.nextElementSibling;
    var lookahead = 0;
    while (sibling != null && lookahead < 4) {
      final snippet = sibling.querySelector('.result-snippet');
      if (snippet != null) {
        final text = _normalizeWhitespace(snippet.text);
        if (text.isNotEmpty) return text;
      }
      sibling = sibling.nextElementSibling;
      lookahead++;
    }
    return null;
  }

  String _normalizeWhitespace(String input) {
    return input.replaceAll(RegExp(r'\s+'), ' ').trim();
  }
}
