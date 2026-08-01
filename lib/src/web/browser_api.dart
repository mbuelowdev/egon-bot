import 'dart:async';
import 'dart:typed_data';

import 'cdp_client.dart';

/// Result of a single browser analyze call.
class BrowseResult {
  BrowseResult({
    required this.url,
    required this.title,
    required this.text,
    required this.truncated,
    required this.links,
    required this.network,
    required this.screenshotBytes,
    required this.screenshotMime,
  });

  final String url;
  final String title;
  final String text;
  final bool truncated;
  final List<Map<String, Object?>> links;
  final List<Map<String, Object?>> network;
  final Uint8List screenshotBytes;
  final String screenshotMime;

  factory BrowseResult.fromCdp(CdpPageResult page) => BrowseResult(
        url: page.url,
        title: page.title,
        text: page.text,
        truncated: page.truncated,
        links: page.links,
        network: page.network,
        screenshotBytes: page.screenshotBytes,
        screenshotMime: page.screenshotMime,
      );
}

typedef CdpAnalyzeFn = Future<CdpPageResult> Function({
  required Uri cdpHttpBase,
  required String url,
  required String userAgent,
  Duration timeout,
});

/// Dart CDP driver for a remote Chromium (`BROWSER_API_BASE_URL`, typically
/// `http://172.17.0.1:9222` → chromedp/headless-shell).
class BrowserApi {
  BrowserApi({
    this.baseUrl,
    this.userAgent = defaultUserAgent,
    Duration? timeout,
    CdpAnalyzeFn? analyzeImpl,
  })  : _timeout = timeout ?? const Duration(seconds: 60),
        _analyzeImpl = analyzeImpl ?? _defaultAnalyze;

  /// Null when [BROWSER_API_BASE_URL] is unset (local/dev without browser).
  final Uri? baseUrl;

  /// Chrome-like UA sent via CDP `Network.setUserAgentOverride`.
  final String userAgent;

  final Duration _timeout;
  final CdpAnalyzeFn _analyzeImpl;

  static const defaultUserAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  static Future<CdpPageResult> _defaultAnalyze({
    required Uri cdpHttpBase,
    required String url,
    required String userAgent,
    Duration timeout = const Duration(seconds: 45),
  }) {
    return cdpAnalyzePage(
      cdpHttpBase: cdpHttpBase,
      url: url,
      userAgent: userAgent,
      timeout: timeout,
    );
  }

  bool get isConfigured => baseUrl != null;

  Future<void>? _queueTail;

  /// Serializes analyzes — one CDP target at a time against the shared Chrome.
  Future<BrowseResult> analyze(
    String url, {
    int? timeoutMs,
    String? waitUntil,
  }) async {
    // waitUntil kept for call-site compatibility; CDP waits on loadEventFired.
    final base = baseUrl;
    if (base == null) {
      throw StateError(
        'BROWSER_API_BASE_URL is not set — browser analysis unavailable.',
      );
    }

    final previous = _queueTail;
    final gate = Completer<void>();
    _queueTail = gate.future;
    if (previous != null) {
      try {
        await previous;
      } catch (_) {
        // Prior job's error must not block the queue.
      }
    }

    try {
      final timeout = timeoutMs == null
          ? _timeout
          : Duration(milliseconds: timeoutMs.clamp(5000, 120000));
      final page = await _analyzeImpl(
        cdpHttpBase: base,
        url: url,
        userAgent: userAgent,
        timeout: timeout,
      );
      return BrowseResult.fromCdp(page);
    } finally {
      gate.complete();
      if (identical(_queueTail, gate.future)) {
        _queueTail = null;
      }
    }
  }
}
