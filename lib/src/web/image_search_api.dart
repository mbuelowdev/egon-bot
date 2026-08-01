import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Single image hit from [ImageSearchApi.search].
class ImageSearchResult {
  ImageSearchResult({
    required this.title,
    required this.imageUrl,
    required this.thumbnailUrl,
    required this.sourcePage,
    this.width,
    this.height,
  });

  final String title;
  final String imageUrl;
  final String thumbnailUrl;
  final String sourcePage;
  final int? width;
  final int? height;

  Map<String, Object?> toJson() => {
        'title': title,
        'image_url': imageUrl,
        'thumbnail_url': thumbnailUrl,
        'source_page': sourcePage,
        if (width != null) 'width': width,
        if (height != null) 'height': height,
      };
}

/// Keyless image search via DuckDuckGo's unofficial `i.js` JSON endpoint.
///
/// Flow: load `duckduckgo.com/?q=…` to extract a per-query `vqd` token, then
/// GET `duckduckgo.com/i.js` with that token. Failures return an empty list so
/// the chat loop can continue (same contract as [SearchApi]).
class ImageSearchApi {
  ImageSearchApi({HttpClient? httpClient, Duration? timeout})
      : _httpClient = httpClient ?? HttpClient(),
        _timeout = timeout ?? const Duration(seconds: 8);

  static final Uri _home = Uri.parse('https://duckduckgo.com/');
  static final Uri _imagesEndpoint = Uri.parse('https://duckduckgo.com/i.js');

  static const String _userAgent =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /// Matches `vqd="4-…"` / `vqd='…'` / `vqd=4-…` in the SERP HTML/JS bootstrap.
  static final RegExp _vqdPattern = RegExp(
    r'''vqd[=:]["']?([0-9-]+)["']?''',
  );

  final HttpClient _httpClient;
  final Duration _timeout;

  Future<List<ImageSearchResult>> search(
    String query, {
    int limit = 5,
    bool safeSearch = true,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      return const [];
    }

    try {
      return await _searchOnce(
        trimmed,
        limit: limit,
        safeSearch: safeSearch,
      );
    } catch (error, stackTrace) {
      stderr.writeln('Image search for "$trimmed" failed: $error');
      stderr.writeln(stackTrace);
    }

    try {
      await Future<void>.delayed(const Duration(milliseconds: 350));
      return await _searchOnce(
        trimmed,
        limit: limit,
        safeSearch: safeSearch,
      );
    } catch (error) {
      stderr.writeln('Image search retry for "$trimmed" failed: $error');
      return const [];
    }
  }

  Future<List<ImageSearchResult>> _searchOnce(
    String query, {
    required int limit,
    required bool safeSearch,
  }) async {
    final vqd = await _fetchVqd(query);
    final body = await _fetchImagesJson(query, vqd, safeSearch: safeSearch);
    return parseResults(body, limit: limit);
  }

  Future<String> _fetchVqd(String query) async {
    final uri = _home.replace(queryParameters: {'q': query});
    final html = await _getText(
      uri,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    );
    final vqd = extractVqd(html);
    if (vqd == null) {
      throw StateError('DuckDuckGo image search: no vqd token for "$query"');
    }
    return vqd;
  }

  Future<String> _fetchImagesJson(
    String query,
    String vqd, {
    required bool safeSearch,
  }) async {
    final uri = _imagesEndpoint.replace(queryParameters: {
      'l': 'wt-wt',
      'o': 'json',
      'q': query,
      'vqd': vqd,
      // time,size,color,type,layout,license — empty = no filters
      'f': ',,,,,',
      // DDG: "1" = SafeSearch on/moderate, "-1" = off
      'p': safeSearch ? '1' : '-1',
    });
    return _getText(
      uri,
      accept: 'application/json,text/javascript,*/*;q=0.8',
      referer: 'https://duckduckgo.com/',
    );
  }

  Future<String> _getText(
    Uri uri, {
    required String accept,
    String? referer,
  }) async {
    final request = await _httpClient.getUrl(uri).timeout(_timeout);
    request.headers
      ..set(HttpHeaders.userAgentHeader, _userAgent)
      ..set(HttpHeaders.acceptHeader, accept)
      ..set(HttpHeaders.acceptLanguageHeader, 'de-DE,de;q=0.9,en;q=0.8');
    if (referer != null) {
      request.headers.set(HttpHeaders.refererHeader, referer);
    }
    final response = await request.close().timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'DDG image search returned ${response.statusCode} for $uri',
      );
    }
    return utf8.decodeStream(response).timeout(_timeout);
  }

  /// Public for unit tests.
  static String? extractVqd(String html) {
    final match = _vqdPattern.firstMatch(html);
    final value = match?.group(1)?.trim();
    if (value == null || value.isEmpty) return null;
    return value;
  }

  /// Public for unit tests. Parses the `i.js` JSON body.
  static List<ImageSearchResult> parseResults(
    String body, {
    required int limit,
  }) {
    if (limit <= 0) return const [];
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } catch (_) {
      return const [];
    }
    if (decoded is! Map) return const [];
    final rawResults = decoded['results'];
    if (rawResults is! List) return const [];

    final results = <ImageSearchResult>[];
    final seen = <String>{};
    for (final item in rawResults) {
      if (results.length >= limit) break;
      if (item is! Map) continue;
      final map = Map<String, Object?>.from(item);
      final imageUrl = _httpUrl(map['image']);
      if (imageUrl == null) continue;
      if (!seen.add(imageUrl)) continue;
      final title = _asString(map['title']) ?? '';
      final thumbnail = _httpUrl(map['thumbnail']) ?? imageUrl;
      final sourcePage = _httpUrl(map['url']) ?? '';
      results.add(
        ImageSearchResult(
          title: title,
          imageUrl: imageUrl,
          thumbnailUrl: thumbnail,
          sourcePage: sourcePage,
          width: _asInt(map['width']),
          height: _asInt(map['height']),
        ),
      );
    }
    return results;
  }

  static String? _httpUrl(Object? value) {
    final raw = _asString(value);
    if (raw == null || raw.isEmpty) return null;
    Uri uri;
    try {
      uri = Uri.parse(raw);
    } catch (_) {
      return null;
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') return null;
    if (uri.host.isEmpty) return null;
    return uri.toString();
  }

  static String? _asString(Object? value) {
    if (value is String) return value.trim();
    return null;
  }

  static int? _asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value.trim());
    return null;
  }
}
