import 'dart:convert';
import 'dart:io';

class ExternalApi {
  ExternalApi({
    required this.ollamaBaseUrl,
    required this.windowsMonitorBaseUrl,
    required this.ollamaModel,
  });

  final Uri ollamaBaseUrl;
  final Uri windowsMonitorBaseUrl;
  final String ollamaModel;
  final HttpClient _httpClient = HttpClient();

  Future<bool> isUserActive() async {
    final json = await _getJson(
      windowsMonitorBaseUrl.resolve('/isUserActive'),
    );
    return json['isUserActive'] == true;
  }

  Future<Map<String, Object?>> getResourceUsage() async {
    final json = await _getJson(
      windowsMonitorBaseUrl.resolve('/getResourceUsage'),
    );
    return json;
  }

  Future<String> generateReply({
    required String prompt,
  }) async {
    final json = await _postJson(
      ollamaBaseUrl.resolve('/api/generate'),
      {
        'model': ollamaModel,
        'prompt': prompt,
        'stream': false,
      },
    );

    final response = json['response'];
    if (response is String && response.trim().isNotEmpty) {
      return response.trim();
    }
    throw StateError('Ollama response did not contain text.');
  }

  Future<Map<String, Object?>> _getJson(Uri uri) async {
    final request = await _httpClient.getUrl(uri);
    final response = await request.close();
    return _readJsonResponse(response, uri);
  }

  Future<Map<String, Object?>> _postJson(
    Uri uri,
    Map<String, Object?> body,
  ) async {
    final request = await _httpClient.postUrl(uri);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close();
    return _readJsonResponse(response, uri);
  }

  Future<Map<String, Object?>> _readJsonResponse(
    HttpClientResponse response,
    Uri uri,
  ) async {
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
