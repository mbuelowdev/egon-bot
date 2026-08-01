import 'dart:convert';
import 'dart:io';

/// Client for the Windows monitor sidecar (`tools/windows_monitor_api.dart`)
/// that runs on the same Windows machine as Ollama.
///
/// The GPU is shared with the machine's primary user (gaming via Parsec), so
/// before issuing expensive Ollama calls the bot asks this API whether the
/// GPU is free. See ARCHITECTURE.md §5.1.
class WindowsMonitorClient {
  WindowsMonitorClient({required this.baseUrl, Duration? timeout})
      : _timeout = timeout ?? const Duration(seconds: 5);

  final Uri baseUrl;
  final Duration _timeout;
  final HttpClient _httpClient = HttpClient();

  /// True while someone is actively using the machine (Parsec session
  /// connected). Big-model calls must wait while this is true.
  Future<bool> isUserActive() async {
    final json = await _getJson(baseUrl.resolve('/isUserActive'));
    return json['isUserActive'] == true;
  }

  /// Current + 5-minute-average CPU/GPU utilization percentages.
  Future<Map<String, Object?>> getResourceUsage() async {
    return _getJson(baseUrl.resolve('/getResourceUsage'));
  }

  Future<Map<String, Object?>> _getJson(Uri uri) async {
    final request = await _httpClient.getUrl(uri).timeout(_timeout);
    final response = await request.close().timeout(_timeout);
    final payload = await utf8.decodeStream(response).timeout(_timeout);
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
