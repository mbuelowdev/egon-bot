import 'dart:convert';
import 'dart:io';

import 'ollama_models.dart';

/// Thin HTTP client for a local Ollama instance.
class OllamaClient {
  OllamaClient({
    required this.baseUrl,
    required this.model,
    Duration? chatTimeout,
  }) : _chatTimeout = chatTimeout ?? const Duration(seconds: 120);

  final Uri baseUrl;
  final String model;
  final Duration _chatTimeout;
  final HttpClient _httpClient = HttpClient();

  static const _controlTimeout = Duration(seconds: 10);

  /// Sends a chat-style request to Ollama, optionally declaring [tools] the
  /// model is allowed to invoke. Returns the assistant message, including any
  /// `tool_calls` it emitted.
  ///
  /// [modelOverride] selects a different model for this call (used for the
  /// CPU-only utility tier). [options] are passed through to Ollama, e.g.
  /// `{'num_gpu': 0}` to keep a model off the GPU entirely.
  ///
  /// [think] enables Ollama thinking / reasoning effort. Defaults to `"high"`
  /// (required shape for gpt-oss: `low` / `medium` / `high`). Pass `null` to
  /// omit the field.
  Future<OllamaChatMessage> chatCompletion({
    required List<OllamaChatMessage> messages,
    List<OllamaTool> tools = const [],
    String? modelOverride,
    Map<String, Object?>? options,

    /// Ollama `format`: `"json"` or a JSON-Schema object for structured output.
    Object? format,
    Object? think = 'high',
  }) async {
    final body = <String, Object?>{
      'model': modelOverride ?? model,
      'messages': messages.map((m) => m.toJson()).toList(),
      'stream': false,
    };
    if (tools.isNotEmpty) {
      body['tools'] = tools.map((t) => t.toJson()).toList();
    }
    if (options != null && options.isNotEmpty) {
      body['options'] = options;
    }
    if (format != null) {
      body['format'] = format;
    }
    if (think != null) {
      body['think'] = think;
    }

    final json = await _postJson(
      baseUrl.resolve('/api/chat'),
      body,
      timeout: _chatTimeout,
    );

    final raw = json['message'];
    if (raw is Map) {
      return OllamaChatMessage.fromJson(raw.cast<String, Object?>());
    }
    throw StateError('Ollama chat response did not contain a message.');
  }

  /// Names of models currently loaded into memory (`/api/ps`).
  Future<List<String>> loadedModels() async {
    final json = await _getJson(
      baseUrl.resolve('/api/ps'),
      timeout: _controlTimeout,
    );
    final models = json['models'];
    if (models is! List) return const [];
    return [
      for (final m in models)
        if (m is Map && m['name'] is String) m['name'] as String,
    ];
  }

  /// Asks Ollama to evict [modelName] from memory immediately. Only call
  /// when the model is actually loaded — an unload request for an unloaded
  /// model would load it first.
  Future<void> requestUnload(String modelName) async {
    await _postJson(
        baseUrl.resolve('/api/generate'),
        {
          'model': modelName,
          'prompt': '',
          'keep_alive': 0,
          'stream': false,
        },
        timeout: _controlTimeout);
  }

  Future<Map<String, Object?>> _getJson(
    Uri uri, {
    required Duration timeout,
  }) async {
    final request = await _httpClient.getUrl(uri).timeout(timeout);
    final response = await request.close().timeout(timeout);
    return _readJsonResponse(response, uri, timeout: timeout);
  }

  Future<Map<String, Object?>> _postJson(
    Uri uri,
    Map<String, Object?> body, {
    required Duration timeout,
  }) async {
    final request = await _httpClient.postUrl(uri).timeout(timeout);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close().timeout(timeout);
    return _readJsonResponse(response, uri, timeout: timeout);
  }

  Future<Map<String, Object?>> _readJsonResponse(
    HttpClientResponse response,
    Uri uri, {
    required Duration timeout,
  }) async {
    final payload = await utf8.decodeStream(response).timeout(timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'Request to $uri failed with ${response.statusCode}: $payload',
      );
    }

    final decoded = jsonDecode(payload);
    if (decoded is Map<String, Object?>) {
      return decoded;
    }
    throw FormatException('Expected JSON object from $uri');
  }
}
