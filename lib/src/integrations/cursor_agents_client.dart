import 'dart:convert';
import 'dart:io';

/// Minimal Cursor Cloud Agents REST client (`https://api.cursor.com/v1`).
///
/// Auth: Bearer [apiKey]. See https://cursor.com/docs/cloud-agent/api/endpoints
class CursorAgentsClient {
  CursorAgentsClient({
    required this.apiKey,
    Uri? baseUrl,
    Duration? timeout,
  })  : baseUrl = baseUrl ?? Uri.parse('https://api.cursor.com'),
        _timeout = timeout ?? const Duration(seconds: 60);

  final String apiKey;
  final Uri baseUrl;
  final Duration _timeout;
  final HttpClient _httpClient = HttpClient();

  /// Creates a cloud agent and enqueues its first run.
  Future<CursorAgentCreateResult> createAgent({
    required String promptText,
    required String repoUrl,
    required String startingRef,
    bool autoCreatePr = false,
    String mode = 'agent',
    String? name,
    String? modelId,
  }) async {
    final body = <String, Object?>{
      'prompt': {'text': promptText},
      'repos': [
        {
          'url': repoUrl,
          'startingRef': startingRef,
        },
      ],
      'autoCreatePR': autoCreatePr,
      'mode': mode,
      if (name != null && name.isNotEmpty) 'name': name,
      if (modelId != null && modelId.isNotEmpty) 'model': {'id': modelId},
    };
    final json = await _postJson(baseUrl.resolve('/v1/agents'), body);
    return CursorAgentCreateResult.fromJson(json);
  }

  /// Follow-up prompt on an existing agent.
  Future<CursorRun> createRun({
    required String agentId,
    required String promptText,
    String? mode,
  }) async {
    final body = <String, Object?>{
      'prompt': {'text': promptText},
      if (mode != null && mode.isNotEmpty) 'mode': mode,
    };
    final json = await _postJson(
      baseUrl.resolve('/v1/agents/$agentId/runs'),
      body,
    );
    return CursorRun.fromJson(json);
  }

  Future<CursorAgent> getAgent(String agentId) async {
    final json = await _getJson(baseUrl.resolve('/v1/agents/$agentId'));
    return CursorAgent.fromJson(json);
  }

  Future<CursorRun> getRun({
    required String agentId,
    required String runId,
  }) async {
    final json = await _getJson(
      baseUrl.resolve('/v1/agents/$agentId/runs/$runId'),
    );
    return CursorRun.fromJson(json);
  }

  Future<void> cancelRun({
    required String agentId,
    required String runId,
  }) async {
    await _postJson(
      baseUrl.resolve('/v1/agents/$agentId/runs/$runId/cancel'),
      const {},
    );
  }

  Future<void> archiveAgent(String agentId) async {
    await _postJson(
      baseUrl.resolve('/v1/agents/$agentId/archive'),
      const {},
    );
  }

  Future<Map<String, Object?>> _getJson(Uri uri) async {
    final request = await _httpClient.getUrl(uri).timeout(_timeout);
    _auth(request);
    final response = await request.close().timeout(_timeout);
    return _decode(uri, response);
  }

  Future<Map<String, Object?>> _postJson(
    Uri uri,
    Map<String, Object?> body,
  ) async {
    final request = await _httpClient.postUrl(uri).timeout(_timeout);
    _auth(request);
    request.headers.contentType = ContentType.json;
    request.write(jsonEncode(body));
    final response = await request.close().timeout(_timeout);
    return _decode(uri, response);
  }

  void _auth(HttpClientRequest request) {
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $apiKey');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
  }

  Future<Map<String, Object?>> _decode(
    Uri uri,
    HttpClientResponse response,
  ) async {
    final payload = await utf8.decodeStream(response).timeout(_timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CursorAgentsException(
        'Request to $uri failed with ${response.statusCode}: $payload',
        statusCode: response.statusCode,
      );
    }
    if (payload.trim().isEmpty) {
      return <String, Object?>{};
    }
    final decoded = jsonDecode(payload);
    if (decoded is Map<String, Object?>) {
      return decoded;
    }
    if (decoded is Map) {
      return decoded.cast<String, Object?>();
    }
    throw FormatException('Expected JSON object from $uri');
  }
}

class CursorAgentsException implements Exception {
  CursorAgentsException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'CursorAgentsException: $message';
}

class CursorAgentCreateResult {
  CursorAgentCreateResult({required this.agent, required this.run});

  final CursorAgent agent;
  final CursorRun run;

  factory CursorAgentCreateResult.fromJson(Map<String, Object?> json) {
    final agentRaw = json['agent'];
    final runRaw = json['run'];
    if (agentRaw is! Map || runRaw is! Map) {
      throw FormatException('createAgent response missing agent/run');
    }
    return CursorAgentCreateResult(
      agent: CursorAgent.fromJson(agentRaw.cast<String, Object?>()),
      run: CursorRun.fromJson(runRaw.cast<String, Object?>()),
    );
  }
}

class CursorAgent {
  CursorAgent({
    required this.id,
    required this.status,
    this.name,
    this.url,
    this.latestRunId,
    this.autoCreatePr,
  });

  final String id;
  final String status;
  final String? name;
  final String? url;
  final String? latestRunId;
  final bool? autoCreatePr;

  factory CursorAgent.fromJson(Map<String, Object?> json) {
    return CursorAgent(
      id: json['id'] as String,
      status: json['status'] as String? ?? 'UNKNOWN',
      name: json['name'] as String?,
      url: json['url'] as String?,
      latestRunId: json['latestRunId'] as String?,
      autoCreatePr: json['autoCreatePR'] as bool?,
    );
  }
}

/// Run statuses from the Cloud Agents API.
abstract final class CursorRunStatus {
  static const creating = 'CREATING';
  static const running = 'RUNNING';
  static const finished = 'FINISHED';
  static const error = 'ERROR';
  static const cancelled = 'CANCELLED';
  static const expired = 'EXPIRED';

  static const terminal = {finished, error, cancelled, expired};
  static const active = {creating, running};
}

class CursorRun {
  CursorRun({
    required this.id,
    required this.agentId,
    required this.status,
    this.result,
    this.git,
  });

  final String id;
  final String agentId;
  final String status;
  final String? result;
  final CursorRunGit? git;

  bool get isTerminal => CursorRunStatus.terminal.contains(status);

  String? get firstPrUrl {
    final branches = git?.branches;
    if (branches == null) return null;
    for (final branch in branches) {
      final url = branch.prUrl;
      if (url != null && url.isNotEmpty) return url;
    }
    return null;
  }

  factory CursorRun.fromJson(Map<String, Object?> json) {
    CursorRunGit? git;
    final gitRaw = json['git'];
    if (gitRaw is Map) {
      git = CursorRunGit.fromJson(gitRaw.cast<String, Object?>());
    }
    return CursorRun(
      id: json['id'] as String,
      agentId: json['agentId'] as String? ?? '',
      status: json['status'] as String? ?? 'UNKNOWN',
      result: json['result'] as String?,
      git: git,
    );
  }
}

class CursorRunGit {
  CursorRunGit({required this.branches});

  final List<CursorBranch> branches;

  factory CursorRunGit.fromJson(Map<String, Object?> json) {
    final raw = json['branches'];
    final branches = <CursorBranch>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          branches.add(CursorBranch.fromJson(item.cast<String, Object?>()));
        }
      }
    }
    return CursorRunGit(branches: branches);
  }
}

class CursorBranch {
  CursorBranch({this.repoUrl, this.branch, this.prUrl});

  final String? repoUrl;
  final String? branch;
  final String? prUrl;

  factory CursorBranch.fromJson(Map<String, Object?> json) {
    return CursorBranch(
      repoUrl: json['repoUrl'] as String?,
      branch: json['branch'] as String?,
      prUrl: json['prUrl'] as String?,
    );
  }
}
