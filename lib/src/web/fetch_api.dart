import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

import 'ssrf_guard.dart';

/// An image URL discovered while extracting an HTML page.
class PageImage {
  PageImage({
    required this.url,
    this.alt = '',
    this.kind = 'img',
  });

  /// Absolute http(s) image URL.
  final String url;

  /// `alt` text when taken from an `<img>`, otherwise empty.
  final String alt;

  /// Provenance: `og`, `twitter`, `link`, or `img`.
  final String kind;

  Map<String, Object?> toJson() => {
        'url': url,
        'alt': alt,
        'kind': kind,
      };
}

/// Result of a single [FetchApi.fetch] call.
class FetchedPage {
  FetchedPage({
    required this.url,
    required this.title,
    required this.text,
    required this.contentType,
    required this.truncated,
    List<PageImage>? images,
  }) : images = images ?? const [];

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

  /// Image candidates from Open Graph / Twitter / `<img>` (HTML only).
  final List<PageImage> images;

  Map<String, Object?> toJson() => {
        'url': url,
        'title': title,
        'content_type': contentType,
        'truncated': truncated,
        'images': [for (final image in images) image.toJson()],
        'text': text,
      };
}

/// Bytes downloaded from a public URL (images, PDFs, … — not HTML pages).
class DownloadedFile {
  DownloadedFile({
    required this.url,
    required this.name,
    required this.mime,
    required this.bytes,
  });

  final String url;
  final String name;
  final String mime;
  final Uint8List bytes;

  int get sizeBytes => bytes.length;
}

/// Fetches the contents of a public URL and returns a model-friendly
/// plain-text representation.
///
/// Supports HTML (with script/style/nav noise stripped), plain text, JSON,
/// and other text-like MIME types. Binary content is rejected by [fetch] so we
/// never blast a megabyte of base64 into the prompt; use [download] for files.
/// All limits (timeout, byte cap, character cap) are configurable for tests.
class FetchApi {
  FetchApi({
    HttpClient? httpClient,
    Duration? timeout,
    int? maxBytes,
    int? maxTextChars,
    int? maxImages,
  })  : _httpClient = httpClient ?? HttpClient(),
        _timeout = timeout ?? const Duration(seconds: 10),
        _maxBytes = maxBytes ?? 2 * 1024 * 1024,
        _maxTextChars = maxTextChars ?? 8000,
        _maxImages = maxImages ?? 15;

  /// A realistic desktop user-agent. Sites often serve a stripped-down or
  /// challenge page to obviously-empty UAs, which would defeat the tool.
  static const String _userAgent =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  final HttpClient _httpClient;
  final Duration _timeout;
  final int _maxBytes;
  final int _maxTextChars;
  final int _maxImages;

  /// Performs a GET on [url] and returns its extracted text representation.
  ///
  /// Throws on transport errors, non-2xx status codes, unsupported content
  /// types, or invalid URLs. The caller is expected to catch and surface a
  /// model-friendly error message.
  Future<FetchedPage> fetch(String url) async {
    final parsed = _parseAllowedUri(url);
    await assertPublicHttpUri(parsed);

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

    final mimeType =
        response.headers.contentType?.mimeType ?? 'application/octet-stream';

    if (!_isTextLike(mimeType)) {
      throw HttpException(
        'unsupported content-type: $mimeType (only text/* and JSON/XML are '
        'supported; use download_and_send for images/files)',
      );
    }

    final bytes = await _readBoundedBody(response, _maxBytes);
    final overByteCap = bytes.length >= _maxBytes;
    final charset = response.headers.contentType?.charset ?? 'utf-8';
    final decoded = _decode(bytes, charset);

    if (mimeType == 'text/html' || mimeType == 'application/xhtml+xml') {
      final extracted = _extractFromHtml(decoded, parsed);
      final truncated = overByteCap || extracted.text.length > _maxTextChars;
      return FetchedPage(
        url: parsed.toString(),
        title: extracted.title,
        text: _truncateText(extracted.text),
        contentType: mimeType,
        truncated: truncated,
        images: extracted.images,
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

  /// Downloads binary content (images, PDFs, …) from a public URL.
  ///
  /// Rejects HTML/text responses so callers use [fetch] for pages. [maxBytes]
  /// defaults to the fetch byte cap; tools that post to Discord should pass
  /// the attachment size limit instead.
  Future<DownloadedFile> download(String url, {int? maxBytes}) async {
    final cap = maxBytes ?? _maxBytes;
    final parsed = _parseAllowedUri(url);
    await assertPublicHttpUri(parsed);

    final request = await _httpClient.getUrl(parsed).timeout(_timeout);
    request.headers
      ..set(HttpHeaders.userAgentHeader, _userAgent)
      ..set(
        HttpHeaders.acceptHeader,
        'image/*,application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
      )
      ..set(HttpHeaders.acceptLanguageHeader, 'de-DE,de;q=0.9,en;q=0.8');

    final response = await request.close().timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'GET $parsed returned ${response.statusCode}',
      );
    }

    final mimeType =
        response.headers.contentType?.mimeType ?? 'application/octet-stream';
    if (_isPageLike(mimeType)) {
      throw HttpException(
        'URL returned $mimeType; use fetch_url to read the page, pick an '
        'image URL from images[], then download_and_send that URL.',
      );
    }

    final bytes = await _readBoundedBody(response, cap);
    if (bytes.length >= cap) {
      throw HttpException(
        'Download exceeds size limit (${cap ~/ (1024 * 1024)} MB).',
      );
    }

    final name = _fileNameFromResponse(parsed, response.headers);
    final mime = mimeType == 'application/octet-stream'
        ? _mimeFromName(name) ?? mimeType
        : mimeType;

    return DownloadedFile(
      url: parsed.toString(),
      name: name,
      mime: mime,
      bytes: Uint8List.fromList(bytes),
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

  bool _isPageLike(String mimeType) {
    if (mimeType.startsWith('text/')) return true;
    return mimeType == 'application/xhtml+xml' ||
        mimeType == 'application/json' ||
        mimeType == 'application/xml' ||
        mimeType == 'application/ld+json';
  }

  Future<List<int>> _readBoundedBody(
    HttpClientResponse response,
    int maxBytes,
  ) async {
    final builder = BytesBuilder(copy: false);
    await for (final chunk in response.timeout(_timeout)) {
      builder.add(chunk);
      if (builder.length >= maxBytes) {
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

  _ExtractedHtml _extractFromHtml(String html, Uri pageUrl) {
    final document = html_parser.parse(html);
    final images = extractPageImages(
      document,
      pageUrl,
      maxImages: _maxImages,
    );
    document
        .querySelectorAll(
            'script, style, noscript, svg, template, iframe, link, meta')
        .forEach((dom.Element e) => e.remove());
    final title = document.querySelector('title')?.text.trim() ?? '';
    final body = document.body ?? document.documentElement;
    final text = body == null ? '' : _normalizeWhitespace(body.text);
    return _ExtractedHtml(title: title, text: text, images: images);
  }

  String _normalizeWhitespace(String input) {
    return input.replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  String _truncateText(String input) {
    if (input.length <= _maxTextChars) return input;
    return '${input.substring(0, _maxTextChars - 1)}…';
  }

  static String _fileNameFromResponse(
    Uri url,
    HttpHeaders headers,
  ) {
    final disposition = headers.value('content-disposition');
    if (disposition != null) {
      final starred = RegExp(
        r'''filename\*\s*=\s*UTF-8''([^;\s]+)''',
        caseSensitive: false,
      ).firstMatch(disposition);
      if (starred != null) {
        final decoded = Uri.decodeFull(starred.group(1)!);
        final base = decoded.split(RegExp(r'[/\\]')).last.trim();
        if (base.isNotEmpty) return base;
      }
      final plain = RegExp(
        r'''filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\s]+)''',
        caseSensitive: false,
      ).firstMatch(disposition);
      if (plain != null) {
        final raw = (plain.group(1) ?? plain.group(2) ?? '').trim();
        final base = raw.split(RegExp(r'[/\\]')).last;
        if (base.isNotEmpty) return base;
      }
    }
    if (url.pathSegments.isNotEmpty) {
      final last = url.pathSegments.last.trim();
      if (last.isNotEmpty) return last;
    }
    return 'download.bin';
  }

  static String? _mimeFromName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return null;
  }
}

/// Collects absolute image URLs from a parsed HTML [document].
///
/// Preference order: Open Graph → Twitter card → `link[rel=image_src]` →
/// `<img src>` / `srcset`. Deduplicates by URL and caps at [maxImages].
List<PageImage> extractPageImages(
  dom.Document document,
  Uri pageUrl, {
  int maxImages = 15,
}) {
  final seen = <String>{};
  final out = <PageImage>[];

  void add(String? raw, {required String kind, String alt = ''}) {
    if (out.length >= maxImages) return;
    final absolute = _resolveHttpUrl(pageUrl, raw);
    if (absolute == null) return;
    if (!seen.add(absolute)) return;
    out.add(PageImage(url: absolute, alt: alt, kind: kind));
  }

  for (final meta in document.querySelectorAll('meta')) {
    final property =
        (meta.attributes['property'] ?? meta.attributes['name'] ?? '')
            .trim()
            .toLowerCase();
    final content = meta.attributes['content'];
    if (property == 'og:image' || property == 'og:image:url') {
      add(content, kind: 'og');
    } else if (property == 'twitter:image' || property == 'twitter:image:src') {
      add(content, kind: 'twitter');
    }
  }

  for (final link in document.querySelectorAll('link')) {
    final rel = (link.attributes['rel'] ?? '').trim().toLowerCase();
    if (rel == 'image_src') {
      add(link.attributes['href'], kind: 'link');
    }
  }

  for (final img in document.querySelectorAll('img')) {
    if (out.length >= maxImages) break;
    final alt = (img.attributes['alt'] ?? '').trim();
    final srcset = img.attributes['srcset'];
    final fromSrcset = _bestSrcsetUrl(srcset);
    if (fromSrcset != null) {
      add(fromSrcset, kind: 'img', alt: alt);
      continue;
    }
    add(
      img.attributes['data-src'] ?? img.attributes['src'],
      kind: 'img',
      alt: alt,
    );
  }

  return out;
}

String? _resolveHttpUrl(Uri base, String? raw) {
  if (raw == null) return null;
  final trimmed = raw.trim();
  if (trimmed.isEmpty || trimmed.startsWith('data:')) return null;
  Uri resolved;
  try {
    resolved = base.resolve(trimmed);
  } on FormatException {
    return null;
  }
  if (resolved.scheme != 'http' && resolved.scheme != 'https') return null;
  if (resolved.host.isEmpty) return null;
  return resolved.toString();
}

/// Picks the highest-resolution candidate from a `srcset` attribute.
String? _bestSrcsetUrl(String? srcset) {
  if (srcset == null || srcset.trim().isEmpty) return null;
  String? bestUrl;
  var bestScore = -1.0;
  for (final part in srcset.split(',')) {
    final bits = part.trim().split(RegExp(r'\s+'));
    if (bits.isEmpty || bits.first.isEmpty) continue;
    final url = bits.first;
    var score = 1.0;
    if (bits.length >= 2) {
      final desc = bits[1].toLowerCase();
      if (desc.endsWith('w')) {
        score = double.tryParse(desc.substring(0, desc.length - 1)) ?? score;
      } else if (desc.endsWith('x')) {
        score =
            (double.tryParse(desc.substring(0, desc.length - 1)) ?? 1) * 10000;
      }
    }
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = url;
    }
  }
  return bestUrl;
}

class _ExtractedHtml {
  _ExtractedHtml({
    required this.title,
    required this.text,
    required this.images,
  });
  final String title;
  final String text;
  final List<PageImage> images;
}
