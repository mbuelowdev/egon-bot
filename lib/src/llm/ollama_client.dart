import 'dart:convert';
import 'dart:io';

import 'ollama_models.dart';

/// Thin HTTP client for a local Ollama instance.
class OllamaClient {
  OllamaClient({required this.baseUrl, required this.model});

  final Uri baseUrl;
  final String model;
  final HttpClient _httpClient = HttpClient();

  /// Sends a chat-style request to Ollama, optionally declaring [tools] the
  /// model is allowed to invoke. Returns the assistant message, including any
  /// `tool_calls` it emitted.
  ///
  /// [modelOverride] selects a different model for this call (used for the
  /// CPU-only utility tier). [options] are passed through to Ollama, e.g.
  /// `{'num_gpu': 0}` to keep a model off the GPU entirely.
  Future<OllamaChatMessage> chatCompletion({
    required List<OllamaChatMessage> messages,
    List<OllamaTool> tools = const [],
    String? modelOverride,
    Map<String, Object?>? options,
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

    final json = await _postJson(baseUrl.resolve('/api/chat'), body);

    final raw = json['message'];
    if (raw is Map) {
      return OllamaChatMessage.fromJson(raw.cast<String, Object?>());
    }
    throw StateError('Ollama chat response did not contain a message.');
  }

  Future<Map<String, Object?>> _postJson(
    Uri uri,
    Map<String, Object?> body,
  ) async {
    final request = await _httpClient.postUrl(uri);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close();

    final payload = await utf8.decodeStream(response);
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
