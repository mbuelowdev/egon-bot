import 'dart:convert';

import '../../web/ssrf_guard.dart';
import '../tool.dart';

class HttpRequestTool extends Tool {
  @override
  String get name => 'http_request';

  @override
  String get description =>
      'Makes an HTTP request to a public URL (API calls). Owner-only. '
      'GET/HEAD run immediately; POST/PUT/PATCH/DELETE show the exact request '
      'for approval first. Private/loopback addresses are blocked. Prefer '
      'fetch_url for reading normal web pages. For recurring APIs, consider '
      'create_tool afterwards.';

  @override
  ToolAccess get access => ToolAccess.personal;

  @override
  Map<String, Object?> get parametersJsonSchema => const {
        'type': 'object',
        'properties': {
          'method': {
            'type': 'string',
            'description': 'HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD.',
          },
          'url': {
            'type': 'string',
            'description': 'Absolute http(s) URL.',
          },
          'headers': {
            'type': 'object',
            'description':
                'Optional header map, e.g. {"Authorization":"Bearer …",'
                    '"Content-Type":"application/json"}.',
            'additionalProperties': {'type': 'string'},
          },
          'body': {
            'type': 'string',
            'description': 'Optional request body (string; JSON as text).',
          },
        },
        'required': ['method', 'url'],
      };

  @override
  Future<String?> previewChange(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final method = (args['method'] as String?)?.trim().toUpperCase() ?? '';
    if (method.isEmpty || method == 'GET' || method == 'HEAD') {
      return null;
    }
    final url = (args['url'] as String?)?.trim() ?? '';
    if (url.isEmpty) return null;
    final headers = _headers(args['headers']);
    final body = args['body']?.toString() ?? '';
    final headerLines =
        headers.entries.map((e) => '${e.key}: ${e.value}').join('\n');
    return 'HTTP $method $url\n'
        'Headers:\n${headerLines.isEmpty ? '(none)' : headerLines}\n'
        'Body:\n${body.isEmpty ? '(empty)' : body}';
  }

  @override
  Future<ToolResult> execute(
    ToolContext context,
    Map<String, Object?> args,
  ) async {
    final method = (args['method'] as String?)?.trim() ?? '';
    final url = (args['url'] as String?)?.trim() ?? '';
    if (method.isEmpty || url.isEmpty) {
      return ToolResult.error('method and url are required.');
    }
    try {
      final result = await context.services.httpRequest.request(
        method: method,
        url: url,
        headers: _headers(args['headers']),
        body: args['body']?.toString(),
      );
      return ToolResult.ok(result.toJson());
    } on SsrfBlockedException catch (error) {
      return ToolResult.error(error.message);
    } on ArgumentError catch (error) {
      return ToolResult.error('${error.message}');
    } catch (error) {
      return ToolResult.error('http_request failed: $error');
    }
  }

  Map<String, String> _headers(Object? raw) {
    if (raw == null) return const {};
    if (raw is Map) {
      return {
        for (final e in raw.entries)
          e.key.toString(): e.value?.toString() ?? '',
      };
    }
    if (raw is String && raw.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          return {
            for (final e in decoded.entries)
              e.key.toString(): e.value?.toString() ?? '',
          };
        }
      } catch (_) {}
    }
    return const {};
  }
}
