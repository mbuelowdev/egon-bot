import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Minimal Chrome DevTools Protocol session over the browser WebSocket.
///
/// Talks to a remote Chromium exposing `--remote-debugging-port` (e.g.
/// `chromedp/headless-shell`). Uses flattened sessions (`Target.attachToTarget`
/// with `flatten: true`).
class CdpSession {
  CdpSession._(this._socket);

  final WebSocket _socket;
  final _pending = <int, Completer<Map<String, Object?>>>{};
  final _eventControllers = <String, StreamController<Map<String, Object?>>>{};
  var _nextId = 1;
  StreamSubscription<dynamic>? _sub;

  static Future<CdpSession> connect(Uri wsUrl, {Duration? timeout}) async {
    final socket = await WebSocket.connect(wsUrl.toString())
        .timeout(timeout ?? const Duration(seconds: 15));
    final session = CdpSession._(socket);
    session._sub = socket.listen(
      session._onMessage,
      onError: session._failAll,
      onDone: () => session._failAll(StateError('CDP WebSocket closed')),
      cancelOnError: true,
    );
    return session;
  }

  Stream<Map<String, Object?>> onEvent(String method) {
    return _eventControllers
        .putIfAbsent(
          method,
          () => StreamController<Map<String, Object?>>.broadcast(),
        )
        .stream;
  }

  Future<Map<String, Object?>> send(
    String method, {
    Map<String, Object?> params = const {},
    String? sessionId,
    Duration? timeout,
  }) {
    final id = _nextId++;
    final completer = Completer<Map<String, Object?>>();
    _pending[id] = completer;
    final message = <String, Object?>{
      'id': id,
      'method': method,
      if (params.isNotEmpty) 'params': params,
      if (sessionId != null) 'sessionId': sessionId,
    };
    _socket.add(jsonEncode(message));
    return completer.future.timeout(
      timeout ?? const Duration(seconds: 60),
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('CDP $method timed out');
      },
    );
  }

  void _onMessage(dynamic raw) {
    final decoded =
        jsonDecode(raw is String ? raw : utf8.decode(raw as List<int>));
    if (decoded is! Map) return;
    final map = decoded.cast<String, Object?>();
    final id = map['id'];
    if (id is int) {
      final completer = _pending.remove(id);
      if (completer == null) return;
      if (map.containsKey('error')) {
        completer.completeError(
          StateError('CDP error: ${jsonEncode(map['error'])}'),
        );
      } else {
        final result = map['result'];
        completer.complete(
          result is Map ? result.cast<String, Object?>() : <String, Object?>{},
        );
      }
      return;
    }
    final method = map['method'] as String?;
    if (method == null) return;
    final params = map['params'];
    final event = params is Map
        ? params.cast<String, Object?>()
        : <String, Object?>{};
    _eventControllers[method]?.add(event);
  }

  void _failAll(Object error) {
    for (final completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
  }

  Future<void> close() async {
    await _sub?.cancel();
    for (final c in _eventControllers.values) {
      await c.close();
    }
    _eventControllers.clear();
    await _socket.close();
  }
}

/// Discovers the browser WebSocket URL from Chromium's HTTP `/json/version`.
Future<Uri> resolveBrowserWebSocketUrl(
  Uri httpBase, {
  HttpClient? httpClient,
  Duration? timeout,
}) async {
  final client = httpClient ?? HttpClient();
  final shouldClose = httpClient == null;
  try {
    final versionUrl = Uri(
      scheme: httpBase.scheme,
      host: httpBase.host,
      port: httpBase.hasPort ? httpBase.port : null,
      path: '/json/version',
    );
    final request = await client
        .getUrl(versionUrl)
        .timeout(timeout ?? const Duration(seconds: 10));
    final response =
        await request.close().timeout(timeout ?? const Duration(seconds: 10));
    final body = await utf8
        .decodeStream(response)
        .timeout(timeout ?? const Duration(seconds: 10));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'CDP /json/version failed (${response.statusCode}): $body',
        uri: versionUrl,
      );
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map) {
      throw const FormatException('Expected JSON object from /json/version');
    }
    final raw = decoded['webSocketDebuggerUrl'] as String?;
    if (raw == null || raw.isEmpty) {
      throw const FormatException(
        'Chromium /json/version missing webSocketDebuggerUrl',
      );
    }
    // Chromium often advertises ws://127.0.0.1:9222/... which is wrong when
    // connecting from another container — rewrite to the HTTP base host/port.
    final advertised = Uri.parse(raw);
    return advertised.replace(
      host: httpBase.host,
      port: httpBase.hasPort ? httpBase.port : advertised.port,
    );
  } finally {
    if (shouldClose) client.close(force: true);
  }
}

bool hostLooksBlockedForBrowse(String hostname) {
  final lower = hostname.toLowerCase();
  if (lower.isEmpty ||
      lower == 'localhost' ||
      lower.endsWith('.localhost') ||
      lower.endsWith('.local') ||
      lower == 'metadata.google.internal' ||
      lower == 'metadata') {
    return true;
  }
  final m = RegExp(r'^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$')
      .firstMatch(lower);
  if (m == null) return false;
  final a = int.parse(m.group(1)!);
  final b = int.parse(m.group(2)!);
  if (a == 0 || a == 10 || a == 127) return true;
  if (a == 169 && b == 254) return true;
  if (a == 172 && b >= 16 && b <= 31) return true;
  if (a == 192 && b == 168) return true;
  if (a == 100 && b >= 64 && b <= 127) return true;
  return false;
}

/// Result of a CDP page analysis (before tool packaging).
class CdpPageResult {
  CdpPageResult({
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
}

/// One page analysis via CDP.
Future<CdpPageResult> cdpAnalyzePage({
  required Uri cdpHttpBase,
  required String url,
  required String userAgent,
  Duration timeout = const Duration(seconds: 45),
  int maxText = 12000,
  int maxLinks = 80,
  int maxNetwork = 80,
}) async {
  final target = Uri.parse(url);
  if (target.scheme != 'http' && target.scheme != 'https') {
    throw ArgumentError('Only http/https URLs are allowed.');
  }
  if (hostLooksBlockedForBrowse(target.host)) {
    throw StateError('Host "${target.host}" is blocked (local/metadata).');
  }

  final wsUrl = await resolveBrowserWebSocketUrl(cdpHttpBase);
  final session = await CdpSession.connect(wsUrl, timeout: timeout);
  String? targetId;
  String? sessionId;
  try {
    final created = await session.send(
      'Target.createTarget',
      params: {'url': 'about:blank'},
      timeout: timeout,
    );
    targetId = created['targetId'] as String?;
    if (targetId == null || targetId.isEmpty) {
      throw StateError('Target.createTarget returned no targetId');
    }

    final attached = await session.send(
      'Target.attachToTarget',
      params: {'targetId': targetId, 'flatten': true},
      timeout: timeout,
    );
    sessionId = attached['sessionId'] as String?;
    if (sessionId == null || sessionId.isEmpty) {
      throw StateError('Target.attachToTarget returned no sessionId');
    }

    Future<Map<String, Object?>> pageSend(
      String method, [
      Map<String, Object?> params = const {},
    ]) {
      return session.send(
        method,
        params: params,
        sessionId: sessionId,
        timeout: timeout,
      );
    }

    await pageSend('Page.enable');
    await pageSend('Runtime.enable');
    await pageSend('Network.enable');
    await pageSend('Network.setUserAgentOverride', {
      'userAgent': userAgent,
      'acceptLanguage': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await pageSend('Emulation.setDeviceMetricsOverride', {
      'width': 1280,
      'height': 720,
      'deviceScaleFactor': 1,
      'mobile': false,
    });

    final network = <Map<String, Object?>>[];
    final requestMeta = <String, Map<String, Object?>>{};

    final responseSub = session.onEvent('Network.responseReceived').listen((e) {
      if (network.length >= maxNetwork) return;
      final type = (e['type'] as String?)?.toLowerCase() ?? '';
      if (type != 'xhr' && type != 'fetch' && type != 'document') return;
      final response = (e['response'] as Map?)?.cast<String, Object?>() ?? {};
      final requestId = e['requestId'] as String? ?? '';
      final meta = requestMeta[requestId] ?? {};
      network.add({
        'method': meta['method'] ?? 'GET',
        'url': response['url'] ?? meta['url'] ?? '',
        'status': response['status'],
        'resource_type': type,
        'content_type':
            ((response['mimeType'] as String?) ?? '').split(';').first.trim(),
        'request_id': requestId,
      });
    });
    final requestSub = session.onEvent('Network.requestWillBeSent').listen((e) {
      final requestId = e['requestId'] as String? ?? '';
      final request = (e['request'] as Map?)?.cast<String, Object?>() ?? {};
      requestMeta[requestId] = {
        'method': request['method'] ?? 'GET',
        'url': request['url'] ?? '',
      };
    });

    final loadDone = Completer<void>();
    final loadSub = session.onEvent('Page.loadEventFired').listen((_) {
      if (!loadDone.isCompleted) loadDone.complete();
    });

    await pageSend('Page.navigate', {'url': url});
    try {
      await loadDone.future.timeout(timeout);
    } on TimeoutException {
      // Continue with whatever rendered.
    }
    await Future<void>.delayed(const Duration(milliseconds: 800));
    await responseSub.cancel();
    await requestSub.cancel();
    await loadSub.cancel();

    for (final entry in network) {
      final type = entry['resource_type'] as String? ?? '';
      final ct = entry['content_type'] as String? ?? '';
      final requestId = entry['request_id'] as String?;
      entry.remove('request_id');
      if (requestId == null) continue;
      if (type != 'xhr' && type != 'fetch' && !ct.contains('json')) continue;
      try {
        final body = await pageSend('Network.getResponseBody', {
          'requestId': requestId,
        });
        var text = body['body'] as String? ?? '';
        if (body['base64Encoded'] == true) {
          text = utf8.decode(base64Decode(text), allowMalformed: true);
        }
        if (text.length > 4000) text = '${text.substring(0, 4000)}…';
        final trimmed = text.trimLeft();
        if (ct.contains('json') ||
            trimmed.startsWith('{') ||
            trimmed.startsWith('[')) {
          entry['body_snippet'] = text;
        }
      } catch (_) {
        // Body unavailable (redirect, opaque, etc.).
      }
    }

    final evalText = await pageSend('Runtime.evaluate', {
      'expression': r'''(() => {
        const title = document.title || '';
        const text = document.body ? (document.body.innerText || '') : '';
        const links = [];
        const seen = new Set();
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.href;
          if (!href || seen.has(href)) continue;
          if (!href.startsWith('http://') && !href.startsWith('https://')) continue;
          seen.add(href);
          links.push({
            url: href,
            text: (a.innerText || a.textContent || '').trim().slice(0, 120),
          });
          if (links.length >= 80) break;
        }
        return { title, text, links, href: location.href };
      })()''',
      'returnByValue': true,
      'awaitPromise': true,
    });
    final value =
        ((evalText['result'] as Map?)?.cast<String, Object?>() ?? {})['value'];
    final pageInfo = value is Map ? value.cast<String, Object?>() : {};

    final finalUrl = (pageInfo['href'] as String?) ?? url;
    final finalHost = Uri.tryParse(finalUrl)?.host ?? '';
    if (hostLooksBlockedForBrowse(finalHost)) {
      throw StateError('Final host "$finalHost" is blocked (local/metadata).');
    }

    var text = (pageInfo['text'] as String?) ?? '';
    var truncated = false;
    if (text.length > maxText) {
      text = '${text.substring(0, maxText)}…';
      truncated = true;
    }
    final linksRaw = pageInfo['links'];
    final links = <Map<String, Object?>>[];
    if (linksRaw is List) {
      for (final item in linksRaw.take(maxLinks)) {
        if (item is Map) links.add(item.cast<String, Object?>());
      }
    }

    final shot = await pageSend('Page.captureScreenshot', {
      'format': 'jpeg',
      'quality': 72,
      'fromSurface': true,
    });
    final b64 = shot['data'] as String? ?? '';
    final bytes =
        b64.isEmpty ? Uint8List(0) : Uint8List.fromList(base64Decode(b64));

    return CdpPageResult(
      url: finalUrl,
      title: (pageInfo['title'] as String?) ?? '',
      text: text,
      truncated: truncated,
      links: links,
      network: network.take(maxNetwork).toList(),
      screenshotBytes: bytes,
      screenshotMime: 'image/jpeg',
    );
  } finally {
    if (targetId != null) {
      try {
        await session.send(
          'Target.closeTarget',
          params: {'targetId': targetId},
          timeout: const Duration(seconds: 5),
        );
      } catch (_) {}
    }
    await session.close();
  }
}
