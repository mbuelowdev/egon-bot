import 'dart:convert';

/// Single message in an Ollama `/api/chat` exchange.
///
/// Roles follow the OpenAI-compatible convention used by Ollama:
///   - `system`    : steering / persona / global instructions
///   - `user`      : human turn
///   - `assistant` : model turn (may include [toolCalls])
///   - `tool`      : tool execution result, paired with [toolCallId]
class OllamaChatMessage {
  OllamaChatMessage({
    required this.role,
    this.content = '',
    this.toolCalls = const [],
    this.toolCallId,
    this.name,
  });

  final String role;
  final String content;
  final List<OllamaToolCall> toolCalls;
  final String? toolCallId;
  final String? name;

  Map<String, Object?> toJson() {
    final map = <String, Object?>{'role': role, 'content': content};
    if (toolCalls.isNotEmpty) {
      map['tool_calls'] = toolCalls.map((c) => c.toJson()).toList();
    }
    if (toolCallId != null) {
      map['tool_call_id'] = toolCallId;
    }
    if (name != null) {
      map['name'] = name;
    }
    return map;
  }

  factory OllamaChatMessage.fromJson(Map<String, Object?> json) {
    final rawCalls = json['tool_calls'];
    return OllamaChatMessage(
      role: (json['role'] as String?) ?? 'assistant',
      content: (json['content'] as String?) ?? '',
      toolCalls: rawCalls is List
          ? rawCalls.whereType<Map>().map((m) => OllamaToolCall.fromJson(m.cast<String, Object?>())).toList()
          : const [],
    );
  }
}

/// A single tool invocation requested by the model.
///
/// Ollama returns `arguments` as an already-parsed JSON object, but the
/// upstream OpenAI shape (and some Ollama versions) sends it as a JSON
/// string. [fromJson] handles both shapes.
class OllamaToolCall {
  OllamaToolCall({
    this.id,
    required this.name,
    required this.arguments,
  });

  final String? id;
  final String name;
  final Map<String, Object?> arguments;

  Map<String, Object?> toJson() => {
        if (id != null) 'id': id,
        'function': {
          'name': name,
          'arguments': arguments,
        },
      };

  factory OllamaToolCall.fromJson(Map<String, Object?> json) {
    final fn = (json['function'] as Map?)?.cast<String, Object?>() ?? const <String, Object?>{};
    return OllamaToolCall(
      id: json['id'] as String?,
      name: (fn['name'] as String?) ?? '',
      arguments: _parseArguments(fn['arguments']),
    );
  }

  static Map<String, Object?> _parseArguments(Object? raw) {
    if (raw is Map) {
      return raw.cast<String, Object?>();
    }
    if (raw is String && raw.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          return decoded.cast<String, Object?>();
        }
      } catch (_) {
        // Fall through to the empty-args default below.
      }
    }
    return const <String, Object?>{};
  }
}

/// Declaration of a tool the model is allowed to call.
class OllamaTool {
  const OllamaTool({
    required this.name,
    required this.description,
    required this.parameters,
  });

  final String name;
  final String description;
  final Map<String, Object?> parameters;

  Map<String, Object?> toJson() => {
        'type': 'function',
        'function': {
          'name': name,
          'description': description,
          'parameters': parameters,
        },
      };
}
