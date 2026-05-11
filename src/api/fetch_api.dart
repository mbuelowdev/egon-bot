import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

/// Result of a single [FetchApi.fetch] call.
class FetchedPage {
  FetchedPage({
    required this.url,
    required this.title,
    required this.text,
    required this.contentType,
    required this.truncated,
  });

  /// Final URL after any redirects.
  final String url;

  /// `<title>` of the page when the response was HTML, otherwise empty.
  final String title;

  /// Extracted plain-text body, length-capped per [FetchApi]'s configuration.
  final String text;

  /// MIME type from the response (without parameters), e.g. `text/html`.
  final String contentType;

  /// True if the body was longer than the configured limit and got cut off.
  final bool truncated;

  Map<String, Object?> toJson() => {
        'url': url,
        'title': title,
        'content_type': contentType,
        'truncated': truncated,
        'text': text,
      };
}

/// Fetches the contents of a public URL and returns a model-friendly
/// plain-text representation.
///
/// Supports HTML (with script/style/nav noise stripped), plain text, JSON,
/// and other text-like MIME types. Binary content is rejected up front so we
/// never blast a megabyte of base64 into the prompt. All limits (timeout,
/// byte cap, character cap) are configurable for tests.
class FetchApi {
  FetchApi({
    HttpClient? httpClient,
    Duration? timeout,
    int? maxBytes,
    int? maxTextChars,
  })  : _httpClient = httpClient ?? HttpClient(),
        _timeout = timeout ?? const Duration(seconds: 10),
        _maxBytes = maxBytes ?? 2 * 1024 * 1024,
        _maxTextChars = maxTextChars ?? 8000;

  /// A realistic desktop user-agent. Sites often serve a stripped-down or
  /// challenge page to obviously-empty UAs, which would defeat the tool.
  static const String _userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  final HttpClient _httpClient;
  final Duration _timeout;
  final int _maxBytes;
  final int _maxTextChars;

  /// Performs a GET on [url] and returns its extracted text representation.
  ///
  /// Throws on transport errors, non-2xx status codes, unsupported content
  /// types, or invalid URLs. The caller is expected to catch and surface a
  /// model-friendly error message.
  Future<FetchedPage> fetch(String url) async {
    final parsed = _parseAllowedUri(url);

    final request = await _httpClient.getUrl(parsed).timeout(_timeout);
    request.headers
      ..set(HttpHeaders.userAgentHeader, _userAgent)
      ..set(
        HttpHeaders.acceptHeader,
        'text/html,application/xhtml+xml,application/xml;q=0.9,'
        'application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
      )
      ..set(HttpHeaders.acceptLanguageHeader, 'de-DE,de;q=0.9,en;q=0.8');

    final response = await request.close().timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'GET $parsed returned ${response.statusCode}',
      );
    }

    final mimeType = response.headers.contentType?.mimeType ?? 'application/octet-stream';

    if (!_isTextLike(mimeType)) {
      throw HttpException(
        'unsupported content-type: $mimeType (only text/* and JSON/XML are supported)',
      );
    }

    final bytes = await _readBoundedBody(response);
    final overByteCap = bytes.length >= _maxBytes;
    final charset = response.headers.contentType?.charset ?? 'utf-8';
    final decoded = _decode(bytes, charset);

    if (mimeType == 'text/html' || mimeType == 'application/xhtml+xml') {
      final extracted = _extractFromHtml(decoded);
      final truncated = overByteCap || extracted.text.length > _maxTextChars;
      return FetchedPage(
        url: parsed.toString(),
        title: extracted.title,
        text: _truncateText(extracted.text),
        contentType: mimeType,
        truncated: truncated,
      );
    }

    final truncated = overByteCap || decoded.length > _maxTextChars;
    return FetchedPage(
      url: parsed.toString(),
      title: '',
      text: _truncateText(decoded.trim()),
      contentType: mimeType,
      truncated: truncated,
    );
  }

  Uri _parseAllowedUri(String raw) {
    Uri parsed;
    try {
      parsed = Uri.parse(raw);
    } on FormatException catch (e) {
      throw FormatException('invalid url: ${e.message}');
    }
    if (parsed.scheme != 'http' && parsed.scheme != 'https') {
      throw FormatException(
        'invalid url scheme "${parsed.scheme}" (only http and https are allowed)',
      );
    }
    if (parsed.host.isEmpty) {
      throw const FormatException('invalid url: missing host');
    }
    return parsed;
  }

  bool _isTextLike(String mimeType) {
    if (mimeType.startsWith('text/')) return true;
    return mimeType == 'application/xhtml+xml' ||
        mimeType == 'application/json' ||
        mimeType == 'application/xml' ||
        mimeType == 'application/ld+json';
  }

  Future<List<int>> _readBoundedBody(HttpClientResponse response) async {
    final builder = BytesBuilder(copy: false);
    await for (final chunk in response.timeout(_timeout)) {
      builder.add(chunk);
      if (builder.length >= _maxBytes) {
        break;
      }
    }
    return builder.takeBytes();
  }

  String _decode(List<int> bytes, String charsetName) {
    final encoding = Encoding.getByName(charsetName);
    if (encoding == null || encoding is Utf8Codec) {
      return utf8.decode(bytes, allowMalformed: true);
    }
    try {
      return encoding.decode(bytes);
    } catch (_) {
      return utf8.decode(bytes, allowMalformed: true);
    }
  }

  _ExtractedHtml _extractFromHtml(String html) {
    final document = html_parser.parse(html);
    document
        .querySelectorAll('script, style, noscript, svg, template, iframe, link, meta')
        .forEach((dom.Element e) => e.remove());
    final title = document.querySelector('title')?.text.trim() ?? '';
    final body = document.body ?? document.documentElement;
    final text = body == null ? '' : _normalizeWhitespace(body.text);
    return _ExtractedHtml(title: title, text: text);
  }

  String _normalizeWhitespace(String input) {
    return input.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  String _truncateText(String input) {
    if (input.length <= _maxTextChars) return input;
    return '${input.substring(0, _maxTextChars - 1)}…';
  }
}

class _ExtractedHtml {
  _ExtractedHtml({required this.title, required this.text});
  final String title;
  final String text;
}
