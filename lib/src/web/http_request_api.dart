import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'ssrf_guard.dart';

/// Result of an [HttpRequestApi.request] call.
class HttpRequestResult {
  HttpRequestResult({
    required this.method,
    required this.url,
    required this.statusCode,
    required this.headers,
    required this.body,
    required this.truncated,
  });

  final String method;
  final String url;
  final int statusCode;
  final Map<String, String> headers;
  final String body;
  final bool truncated;

  Map<String, Object?> toJson() => {
        'method': method,
        'url': url,
        'status': statusCode,
        'headers': headers,
        'truncated': truncated,
        'body': body,
      };
}

/// Ad-hoc HTTP client for `http_request` (§11) with SSRF protection.
class HttpRequestApi {
  HttpRequestApi({
    HttpClient? httpClient,
    Duration? timeout,
    int? maxBytes,
    int? maxTextChars,
  })  : _httpClient = httpClient ?? HttpClient(),
        _timeout = timeout ?? const Duration(seconds: 20),
        _maxBytes = maxBytes ?? 2 * 1024 * 1024,
        _maxTextChars = maxTextChars ?? 8000;

  final HttpClient _httpClient;
  final Duration _timeout;
  final int _maxBytes;
  final int _maxTextChars;

  static const allowedMethods = {
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
  };

  Future<HttpRequestResult> request({
    required String method,
    required String url,
    Map<String, String>? headers,
    String? body,
  }) async {
    final verb = method.trim().toUpperCase();
    if (!allowedMethods.contains(verb)) {
      throw ArgumentError(
        'Unsupported method "$method". Allowed: ${allowedMethods.join(', ')}',
      );
    }
    final uri = Uri.parse(url);
    await assertPublicHttpUri(uri);

    final request = await _httpClient.openUrl(verb, uri).timeout(_timeout);
    request.headers.set(
      HttpHeaders.userAgentHeader,
      'egon-bot/1.0 (+https://github.com/mbuelowdev/egon-bot)',
    );
    headers?.forEach((key, value) {
      if (key.toLowerCase() == 'host') return;
      request.headers.set(key, value);
    });
    if (body != null && body.isNotEmpty && verb != 'GET' && verb != 'HEAD') {
      final bytes = utf8.encode(body);
      request.add(bytes);
    }

    final response = await request.close().timeout(_timeout);
    final responseHeaders = <String, String>{};
    response.headers.forEach((name, values) {
      responseHeaders[name] = values.join(', ');
    });

    if (verb == 'HEAD') {
      return HttpRequestResult(
        method: verb,
        url: uri.toString(),
        statusCode: response.statusCode,
        headers: responseHeaders,
        body: '',
        truncated: false,
      );
    }

    final bytes = await _readBoundedBody(response);
    final overByteCap = bytes.length >= _maxBytes;
    final mime = response.headers.contentType?.mimeType ?? '';
    final text = _decodeBody(bytes, response.headers.contentType?.charset);
    final truncated = overByteCap || text.length > _maxTextChars;
    final clipped = text.length > _maxTextChars
        ? '${text.substring(0, _maxTextChars - 1)}…'
        : text;

    // Reject obvious binary for the model.
    if (mime.isNotEmpty &&
        !mime.startsWith('text/') &&
        mime != 'application/json' &&
        mime != 'application/xml' &&
        mime != 'application/xhtml+xml' &&
        mime != 'application/ld+json' &&
        mime != 'application/problem+json' &&
        !_looksLikeText(bytes)) {
      return HttpRequestResult(
        method: verb,
        url: uri.toString(),
        statusCode: response.statusCode,
        headers: responseHeaders,
        body: '(binary body omitted; content-type: $mime, '
            '${bytes.length} bytes)',
        truncated: true,
      );
    }

    return HttpRequestResult(
      method: verb,
      url: uri.toString(),
      statusCode: response.statusCode,
      headers: responseHeaders,
      body: clipped,
      truncated: truncated,
    );
  }

  Future<List<int>> _readBoundedBody(HttpClientResponse response) async {
    final builder = BytesBuilder(copy: false);
    await for (final chunk in response.timeout(_timeout)) {
      builder.add(chunk);
      if (builder.length >= _maxBytes) break;
    }
    return builder.takeBytes();
  }

  String _decodeBody(List<int> bytes, String? charset) {
    final encoding = Encoding.getByName(charset ?? 'utf-8');
    if (encoding == null || encoding is Utf8Codec) {
      return utf8.decode(bytes, allowMalformed: true);
    }
    try {
      return encoding.decode(bytes);
    } catch (_) {
      return utf8.decode(bytes, allowMalformed: true);
    }
  }

  bool _looksLikeText(List<int> bytes) {
    if (bytes.isEmpty) return true;
    var sample = bytes.length > 512 ? bytes.sublist(0, 512) : bytes;
    var nul = 0;
    for (final b in sample) {
      if (b == 0) nul++;
    }
    return nul == 0;
  }
}
